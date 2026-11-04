<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon from "../components/Icon.vue";
import { lanternProduct } from "../shared/lanterns";
import type {
  AdminLantern,
  AdminOverview,
  AdminPage,
  AdminSession,
  AdminUser,
  AdminUserDetail,
} from "../shared/admin";

const checking = ref(true),
  configured = ref(true),
  authenticated = ref(false),
  password = ref(""),
  loggingIn = ref(false),
  csrf = ref(""),
  error = ref(""),
  loading = ref(false);
const overview = ref<AdminOverview | null>(null),
  users = ref<AdminPage<AdminUser> | null>(null),
  lanterns = ref<AdminPage<AdminLantern> | null>(null),
  detail = ref<AdminUserDetail | null>(null),
  detailLoading = ref(false);
const tab = ref<"users" | "lanterns">("users"),
  query = ref(""),
  presence = ref("all"),
  onlyLit = ref(false),
  status = ref("active"),
  sort = ref("lastSeen"),
  direction = ref("desc"),
  page = ref(1);
let timer: ReturnType<typeof setInterval> | undefined,
  debounce: ReturnType<typeof setTimeout> | undefined;
let tableAbort: AbortController | undefined,
  detailAbort: AbortController | undefined,
  overviewAbort: AbortController | undefined;
let disposed = false;
const onKey = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    detail.value = null;
    detailAbort?.abort();
  }
};
const number = (value: number) => new Intl.NumberFormat("ja-JP").format(value);
const date = (value: number) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
const duration = (value: number) => {
  const min = Math.floor(value / 60000);
  return min < 60 ? `${min}分` : `${Math.floor(min / 60)}時間${min % 60}分`;
};
const shortId = (value: string) => value.slice(0, 8);
const totalPages = computed(() =>
  Math.max(
    1,
    Math.ceil(
      ((tab.value === "users" ? users.value : lanterns.value)?.total ?? 0) / 20,
    ),
  ),
);
const asOf = computed(() => overview.value?.asOf ?? 0);
const trendMax = computed(() =>
  Math.max(
    1,
    ...(overview.value?.daily.map((day) =>
      Math.max(day.connections, day.prayers),
    ) ?? [1]),
  ),
);
const csvUrl = computed(() => "/api/admin/users.csv?" + params().toString());
function params() {
  return new URLSearchParams({
    q: query.value,
    presence: presence.value,
    lanterns: onlyLit.value ? "active" : "all",
    status: status.value,
    sort: sort.value,
    direction: direction.value,
    page: String(page.value),
    pageSize: "20",
  });
}
function clearPrivate() {
  authenticated.value = false;
  overview.value = null;
  users.value = null;
  lanterns.value = null;
  detail.value = null;
  csrf.value = "";
  tableAbort?.abort();
  detailAbort?.abort();
  overviewAbort?.abort();
}
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch("/api/admin/" + path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });
  const body = await response.json();
  if (response.status === 401 && path !== "login") {
    clearPrivate();
    throw new Error("セッションが終了しました。もう一度ログインしてください。");
  }
  if (!response.ok)
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : "データを取得できませんでした。",
    );
  return body as T;
}
function report(cause: unknown) {
  if (
    !disposed &&
    !(cause instanceof DOMException && cause.name === "AbortError")
  )
    error.value =
      cause instanceof Error
        ? cause.message
        : "接続を確認してから再度お試しください。";
}
async function loadOverview() {
  overviewAbort?.abort();
  const controller = (overviewAbort = new AbortController());
  try {
    const value = await api<AdminOverview>("overview", {
      signal: controller.signal,
    });
    if (!controller.signal.aborted && !disposed) overview.value = value;
  } catch (cause) {
    report(cause);
  }
}
async function loadTable() {
  if (!authenticated.value) return;
  tableAbort?.abort();
  const controller = (tableAbort = new AbortController());
  loading.value = true;
  try {
    if (tab.value === "users") {
      const value = await api<AdminPage<AdminUser>>("users?" + params(), {
        signal: controller.signal,
      });
      if (!controller.signal.aborted && !disposed) {
        users.value = value;
        page.value = value.page;
      }
    } else {
      const value = await api<AdminPage<AdminLantern>>("lanterns?" + params(), {
        signal: controller.signal,
      });
      if (!controller.signal.aborted && !disposed) {
        lanterns.value = value;
        page.value = value.page;
      }
    }
  } catch (cause) {
    report(cause);
  } finally {
    if (tableAbort === controller) loading.value = false;
  }
}
async function showUser(id: string) {
  detailAbort?.abort();
  const controller = (detailAbort = new AbortController());
  detailLoading.value = true;
  try {
    const value = await api<AdminUserDetail>(
      "users/" + encodeURIComponent(id),
      { signal: controller.signal },
    );
    if (!controller.signal.aborted && !disposed) detail.value = value;
  } catch (cause) {
    report(cause);
  } finally {
    if (detailAbort === controller) detailLoading.value = false;
  }
}
async function refresh() {
  if (!authenticated.value) return;
  error.value = "";
  await Promise.allSettled([
    loadOverview(),
    loadTable(),
    ...(detail.value ? [showUser(detail.value.user.visitorId)] : []),
  ]);
}
async function login() {
  if (loggingIn.value) return;
  loggingIn.value = true;
  error.value = "";
  try {
    const value = await api<AdminSession>("login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password.value }),
    });
    password.value = "";
    if (disposed) return;
    authenticated.value = value.authenticated;
    csrf.value = value.csrfToken ?? "";
    await refresh();
  } catch (cause) {
    password.value = "";
    report(cause);
  } finally {
    loggingIn.value = false;
  }
}
async function logout() {
  try {
    await api("logout", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf.value },
    });
    clearPrivate();
    error.value = "";
  } catch (cause) {
    report(cause);
  }
}
async function takeDown(item: AdminLantern) {
  if (
    !window.confirm(
      `この絵馬を外しますか？\n\n「${item.wish}」\n\n外した絵馬は元に戻せません。`,
    )
  )
    return;
  try {
    await api(`lanterns/${encodeURIComponent(item.id)}/remove`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf.value },
    });
    error.value = "";
    await loadTable();
  } catch (cause) {
    report(cause);
  }
}
function selectTab(value: "users" | "lanterns") {
  tab.value = value;
  query.value = "";
  page.value = 1;
  void loadTable();
}
function order(key: string) {
  direction.value =
    sort.value === key && direction.value === "desc" ? "asc" : "desc";
  sort.value = key;
  page.value = 1;
  void loadTable();
}
function changePage(value: number) {
  page.value = value;
  void loadTable();
}
watch(query, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    page.value = 1;
    void loadTable();
  }, 300);
});
watch([presence, onlyLit, status], () => {
  page.value = 1;
  void loadTable();
});
onMounted(async () => {
  window.addEventListener("keydown", onKey);
  document.title = "管理画面 · こもれび神社";
  try {
    const value = await api<AdminSession>("session");
    if (disposed) return;
    configured.value = value.configured;
    authenticated.value = value.authenticated;
    csrf.value = value.csrfToken ?? "";
    if (authenticated.value) await refresh();
  } catch (cause) {
    report(cause);
  } finally {
    checking.value = false;
  }
  if (!disposed)
    timer = setInterval(() => {
      if (authenticated.value && !document.hidden) void refresh();
    }, 15000);
});
onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener("keydown", onKey);
  clearInterval(timer);
  clearTimeout(debounce);
  tableAbort?.abort();
  overviewAbort?.abort();
  detailAbort?.abort();
  password.value = "";
});
</script>
<template>
  <main v-if="!authenticated" class="admin-login-shell">
    <div class="admin-login-art">
      <span class="admin-brand"
        ><Icon name="shrine" :size="25" />こもれび神社</span
      >
      <div class="admin-login-light"><Icon name="ema" :size="115" /></div>
      <h1>小さな願いが、<br />集まる場所。</h1>
      <p>訪れる人と、掛けられた願いを<br />静かに見守るための管理画面です。</p>
      <a href="/">神社に戻る <Icon name="arrow" :size="15" /></a>
    </div>
    <section class="admin-login-card" aria-labelledby="admin-login-title">
      <span class="admin-kicker">こもれび神社 / 管理画面</span>
      <h2 id="admin-login-title">おかえりなさい。</h2>
      <p>管理用パスワードを入力してください。</p>
      <p v-if="checking" role="status">接続を確認しています…</p>
      <div v-else-if="!configured" class="admin-notice">
        <strong>管理者設定が必要です</strong>
        <p>
          サーバーで
          <code>npm run admin:setup</code>
          を実行し、作成されたパスワードでログインしてください。
        </p>
      </div>
      <form v-else @submit.prevent="login">
        <label for="admin-password">管理用パスワード</label
        ><input
          id="admin-password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          maxlength="256"
          required
          :disabled="loggingIn"
        /><button class="admin-primary" :disabled="loggingIn || !password">
          {{ loggingIn ? "確認しています…" : "ログイン"
          }}<Icon name="arrow" :size="17" />
        </button>
      </form>
      <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
      <small
        >この画面は管理者専用です。ユーザーの記録はログイン後に表示されます。</small
      >
    </section>
  </main>
  <main v-else class="admin-shell">
    <aside class="admin-sidebar">
      <a href="/admin" class="admin-brand"
        ><Icon name="shrine" :size="25" /><span
          >こもれび神社<small>管理画面</small></span
        ></a
      >
      <div class="admin-sidebar-label">境内を見守る</div>
      <nav aria-label="管理メニュー">
        <button
          :class="{ selected: tab === 'users' }"
          @click="selectTab('users')"
        >
          <Icon name="users" :size="19" />ユーザー一覧<Icon
            name="chevron"
            :size="13"
          /></button
        ><button
          :class="{ selected: tab === 'lanterns' }"
          @click="selectTab('lanterns')"
        >
          <Icon name="ema" :size="19" />絵馬一覧<Icon
            name="chevron"
            :size="13"
          />
        </button>
      </nav>
      <div class="admin-sidebar-bottom">
        <a href="/" target="_blank" rel="noopener"
          >神社をひらく <Icon name="arrow" :size="15" /></a
        ><button @click="logout">ログアウト</button
        ><small>表示時刻はすべて日本時間です。</small>
      </div>
    </aside>
    <section class="admin-main">
      <header class="admin-page-header">
        <div>
          <span class="admin-kicker">こもれび神社 / 管理画面</span>
          <h1>境内のいまを、ひと目に。</h1>
          <p>訪れる人と、掛けられた願いの記録。</p>
        </div>
        <div class="admin-update">
          <span v-if="asOf">{{ date(asOf) }} 更新</span
          ><button class="admin-secondary" @click="refresh">
            <Icon name="reset" :size="15" />更新
          </button>
        </div>
      </header>
      <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
      <div class="admin-metrics" aria-label="全体の状況">
        <article>
          <span><Icon name="users" :size="17" />記録ユーザー数</span
          ><strong
            >{{ number(overview?.totals.users ?? 0) }}<small>人</small></strong
          >
          <p>
            <i class="admin-online-dot"></i>いま
            {{ number(overview?.totals.onlineUsers ?? 0) }} 人が接続中
          </p>
        </article>
        <article>
          <span><Icon name="compass" :size="17" />累計接続回数</span
          ><strong
            >{{ number(overview?.totals.connections ?? 0)
            }}<small>回</small></strong
          >
          <p>訪問 {{ number(overview?.totals.visits ?? 0) }} 回</p>
        </article>
        <article>
          <span><Icon name="shrine" :size="17" />累計参拝回数</span
          ><strong
            >{{ number(overview?.totals.prayers ?? 0)
            }}<small>回</small></strong
          >
          <p>完了した参拝を集計</p>
        </article>
        <article class="admin-lit-metric">
          <span><Icon name="ema" :size="17" />掲示中の絵馬</span
          ><strong
            >{{ number(overview?.totals.activeLanterns ?? 0)
            }}<small>枚</small></strong
          >
          <p>
            記録開始後の累計 {{ number(overview?.totals.lanternsHung ?? 0) }} 枚
          </p>
        </article>
      </div>
      <section class="admin-trend">
        <div>
          <span class="admin-kicker">最近7日間</span>
          <h2>日々のあしあと</h2>
          <p>
            <span class="admin-legend-connection"></span>接続
            <span class="admin-legend-prayer"></span>参拝
          </p>
        </div>
        <div class="admin-bars">
          <div
            v-for="day in overview?.daily ?? []"
            :key="day.day"
            :title="`${day.day} 接続${day.connections}回・参拝${day.prayers}回`"
          >
            <div class="admin-bar-pair">
              <i
                :style="{
                  height: `${day.connections ? Math.max(4, (day.connections / trendMax) * 65) : 2}px`,
                }"
              ></i
              ><i
                :style="{
                  height: `${day.prayers ? Math.max(4, (day.prayers / trendMax) * 65) : 2}px`,
                }"
              ></i>
            </div>
            <small>{{ day.day.slice(5).replace("-", "/") }}</small>
          </div>
        </div>
      </section>
      <section class="admin-list-card">
        <div class="admin-list-heading">
          <div>
            <h2>
              {{ tab === "users" ? "ユーザーごとの記録" : "掛けられた願い" }}
            </h2>
            <p>
              {{
                tab === "users"
                  ? "接続・参拝・絵馬の掲示状況をまとめて確認できます。"
                  : "現在保管されている絵馬の状態と願いを確認できます。"
              }}
            </p>
          </div>
          <a v-if="tab === 'users'" class="admin-secondary" :href="csvUrl"
            >CSVを書き出す <Icon name="arrow" :size="14"
          /></a>
        </div>
        <div class="admin-filters">
          <div class="admin-search">
            <Icon name="pin" :size="16" /><input
              v-model="query"
              :aria-label="tab === 'users' ? 'ユーザーを検索' : '絵馬を検索'"
              :placeholder="
                tab === 'users'
                  ? 'ユーザーID・ルームで検索'
                  : '願い・名前・ルーム・ユーザーIDで検索'
              "
              type="search"
            />
          </div>
          <template v-if="tab === 'users'"
            ><select v-model="presence" aria-label="接続状態">
              <option value="all">すべてのユーザー</option>
              <option value="online">接続中のみ</option>
              <option value="offline">オフラインのみ</option></select
            ><label class="admin-filter-check"
              ><input v-model="onlyLit" type="checkbox" />掲示中のみ</label
            ></template
          ><select v-else v-model="status" aria-label="絵馬の状態">
            <option value="active">掲示中</option>
            <option value="expired">期限切れ・保管中</option>
            <option value="all">すべての保管記録</option>
          </select>
        </div>
        <div class="admin-table-wrap" :aria-busy="loading">
          <table v-if="tab === 'users'">
            <thead>
              <tr>
                <th>ユーザー</th>
                <th>
                  <button @click="order('connections')">
                    接続回数
                    {{
                      sort === "connections"
                        ? direction === "desc"
                          ? "↓"
                          : "↑"
                        : ""
                    }}
                  </button>
                </th>
                <th>
                  <button @click="order('prayers')">
                    参拝回数
                    {{
                      sort === "prayers"
                        ? direction === "desc"
                          ? "↓"
                          : "↑"
                        : ""
                    }}
                  </button>
                </th>
                <th>
                  <button @click="order('lanterns')">
                    掲示中
                    {{
                      sort === "lanterns"
                        ? direction === "desc"
                          ? "↓"
                          : "↑"
                        : ""
                    }}
                  </button>
                </th>
                <th>累計掲示</th>
                <th>ルーム</th>
                <th>
                  <button @click="order('lastSeen')">
                    最終訪問
                    {{
                      sort === "lastSeen"
                        ? direction === "desc"
                          ? "↓"
                          : "↑"
                        : ""
                    }}
                  </button>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in users?.items ?? []" :key="user.visitorId">
                <td>
                  <button
                    class="admin-user-button"
                    @click="showUser(user.visitorId)"
                  >
                    <span class="admin-avatar"
                      ><Icon name="users" :size="17" /></span
                    ><span
                      >旅人 {{ shortId(user.visitorId)
                      }}<small
                        ><i
                          :class="{
                            'admin-online-dot': user.online,
                            'admin-offline-dot': !user.online,
                          }"
                        ></i
                        >{{ user.online ? "接続中" : "オフライン" }}</small
                      ></span
                    >
                  </button>
                </td>
                <td class="admin-number">
                  {{ number(user.connectionCount)
                  }}<small>訪問 {{ user.visitCount }} 回</small>
                </td>
                <td class="admin-number">{{ number(user.prayerCount) }}</td>
                <td>
                  <span
                    class="admin-count-badge"
                    :class="{ lit: user.activeLanternCount > 0 }"
                    >{{ user.activeLanternCount }} 枚</span
                  >
                </td>
                <td>{{ user.lanternHangCount }} 枚</td>
                <td>
                  <span class="admin-room-tag">{{ user.lastRoom }}</span>
                </td>
                <td class="admin-date">{{ date(user.lastSeenAt) }}</td>
                <td>
                  <button
                    class="admin-row-detail"
                    :aria-label="`旅人${shortId(user.visitorId)}の詳細`"
                    @click="showUser(user.visitorId)"
                  >
                    <Icon name="chevron" :size="16" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <table v-else>
            <thead>
              <tr>
                <th>絵馬・願い</th>
                <th>ユーザー</th>
                <th>ルーム / 場所</th>
                <th>状態</th>
                <th>掲示日時</th>
                <th>期限</th>
                <th>お知らせ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in lanterns?.items ?? []" :key="item.id">
                <td class="admin-wish-cell">
                  <div>
                    <span
                      class="admin-mini-lantern"
                      :style="{
                        background: lanternProduct(item.productId)?.color,
                      }"
                    ></span
                    ><strong>{{ lanternProduct(item.productId)?.name }}</strong>
                  </div>
                  <p>{{ item.wish }}</p>
                  <small>— {{ item.signature }}</small>
                </td>
                <td>
                  <button
                    v-if="item.visitorId"
                    class="admin-text-button"
                    @click="showUser(item.visitorId)"
                  >
                    旅人 {{ shortId(item.visitorId) }}</button
                  ><span v-else class="admin-muted">記録開始前の利用者</span>
                </td>
                <td>
                  <span class="admin-room-tag">{{ item.room }}</span
                  ><small class="admin-cell-sub"
                    >{{ item.slot + 1 }} 番の場所</small
                  >
                </td>
                <td>
                  <span
                    class="admin-count-badge"
                    :class="{ lit: item.status === 'active' }"
                    >{{
                      item.status === "active" ? "掲示中" : "期限切れ"
                    }}</span
                  >
                </td>
                <td class="admin-date">{{ date(item.createdAt) }}</td>
                <td class="admin-date">{{ date(item.expiresAt) }}</td>
                <td>
                  <span
                    class="admin-count-badge"
                    :class="{ reported: item.reports > 0 }"
                    >{{ item.reports }} 件</span
                  >
                  <button
                    v-if="item.status === 'active'"
                    class="admin-text-button admin-take-down"
                    @click="takeDown(item)"
                  >
                    外す
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div
            v-if="
              !(tab === 'users' ? users?.items.length : lanterns?.items.length)
            "
            class="admin-empty"
          >
            <Icon
              :name="tab === 'users' ? 'users' : 'ema'"
              :size="27"
            /><strong>{{
              loading ? "記録を読み込んでいます…" : "該当する記録はありません"
            }}</strong>
            <p>検索条件を変えるか、しばらくしてから更新してください。</p>
          </div>
        </div>
        <footer class="admin-pagination">
          <span
            >{{ number((tab === "users" ? users : lanterns)?.total ?? 0) }} 件
            <small>· 1ページ20件</small></span
          >
          <div>
            <button
              :disabled="page <= 1 || loading"
              @click="changePage(page - 1)"
            >
              前へ</button
            ><span>{{ page }} / {{ totalPages }}</span
            ><button
              :disabled="page >= totalPages || loading"
              @click="changePage(page + 1)"
            >
              次へ
            </button>
          </div>
        </footer>
      </section>
      <p class="admin-footnote">
        匿名ユーザーは同じブラウザーの訪問キーで識別します。記録開始前の回数は含みません。接続回数には再接続が含まれ、30分以内の再訪は同じ訪問にまとめます。期限切れ一覧は現在保管されている記録のみです。
      </p>
    </section>
    <aside v-if="detail" class="admin-detail" aria-label="ユーザー詳細">
      <div class="admin-detail-heading">
        <div>
          <span class="admin-kicker">ユーザー詳細</span>
          <h2>旅人 {{ shortId(detail.user.visitorId) }}</h2>
        </div>
        <button
          aria-label="詳細を閉じる"
          @click="
            detail = null;
            detailAbort?.abort();
          "
        >
          <Icon name="close" :size="20" />
        </button>
      </div>
      <p class="admin-detail-id">{{ detail.user.visitorId }}</p>
      <div class="admin-detail-metrics">
        <div>
          <span>接続回数</span
          ><strong>{{ detail.user.connectionCount }}<small>回</small></strong>
        </div>
        <div>
          <span>参拝回数</span
          ><strong>{{ detail.user.prayerCount }}<small>回</small></strong>
        </div>
        <div>
          <span>掲示中</span
          ><strong
            >{{ detail.user.activeLanternCount }}<small>枚</small></strong
          >
        </div>
        <div>
          <span>累計滞在</span
          ><strong class="admin-duration">{{
            duration(detail.user.connectedMs)
          }}</strong>
        </div>
      </div>
      <dl class="admin-detail-info">
        <div>
          <dt>初回訪問</dt>
          <dd>{{ date(detail.user.firstSeenAt) }}</dd>
        </div>
        <div>
          <dt>最終訪問</dt>
          <dd>{{ date(detail.user.lastSeenAt) }}</dd>
        </div>
        <div>
          <dt>おみくじ / 絵馬</dt>
          <dd>
            {{ detail.user.fortuneCount }} 回 /
            {{ detail.user.emaViewCount }} 回
          </dd>
        </div>
        <div>
          <dt>累計掲示 / 取り下げ</dt>
          <dd>
            {{ detail.user.lanternHangCount }} 枚 /
            {{ detail.user.lanternRemoveCount }} 枚
          </dd>
        </div>
      </dl>
      <h3>このユーザーの絵馬</h3>
      <article
        v-for="item in detail.lanterns"
        :key="item.id"
        class="admin-detail-lantern"
      >
        <span
          >{{ lanternProduct(item.productId)?.name }}
          <small>{{
            item.status === "active" ? "掲示中" : "期限切れ"
          }}</small></span
        >
        <blockquote>{{ item.wish }}</blockquote>
        <p>{{ item.room }} · {{ date(item.expiresAt) }} まで</p>
      </article>
      <p v-if="!detail.lanterns.length" class="admin-muted">
        現在保管されている絵馬はありません。
      </p>
      <h3>直近の記録 <small>最大30日分</small></h3>
      <div v-for="day in detail.daily" :key="day.day" class="admin-detail-day">
        <span>{{ day.day }}</span
        ><small
          >接続 {{ day.counters.connectionCount }} · 参拝
          {{ day.counters.prayerCount }} · 絵馬
          {{ day.counters.lanternHangCount }}</small
        >
      </div>
      <small v-if="detailLoading" role="status">更新しています…</small>
    </aside>
  </main>
</template>
<style src="./admin.css"></style>
