<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import GameCanvas from "./components/GameCanvas.vue";
import TouchJoystick from "./components/TouchJoystick.vue";
import Icon from "./components/Icon.vue";
import SoundControls from "./components/SoundControls.vue";
import LanternPanel from "./components/LanternPanel.vue";
import { FREE_LANTERN_POLICY, type LanternState } from "./shared/lanterns";
import type { VisitorSummary } from "./shared/visitorStats";
import type {
  GameSnapshot,
  InteractionId,
  SceneLabel,
  VisitorLabel,
} from "./game/types";
import { drawFortune, type Fortune } from "./game/fortunes";
import { RITUAL_STEPS } from "./game/ritual";
import { PLAYER_SPAWN } from "./game/config";
import {
  DEFAULT_ROOM,
  ROOM_CAPACITY,
  validRoom,
  type Presence,
} from "./shared/multiplayer";

const game = ref<InstanceType<typeof GameCanvas>>();
const ready = ref(false);
const guideOpen = ref(false);
const roomOpen = ref(false);
const initialRoom =
  new URLSearchParams(location.search).get("room") ?? DEFAULT_ROOM;
const roomDraft = ref(validRoom(initialRoom) ? initialRoom : DEFAULT_ROOM);
const presence = ref<Presence>({
  state: "connecting",
  room: roomDraft.value,
  count: 1,
  capacity: ROOM_CAPACITY,
  selfId: null,
  selfName: "旅人",
  peers: [],
});
const visitorLabels = ref<VisitorLabel[]>([]);
const profile = ref<VisitorSummary | null>(null);
const connectedTime = computed(() => {
  const minutes = Math.floor((profile.value?.connectedMs ?? 0) / 60000);
  return minutes < 60
    ? `${minutes}分`
    : `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
});
const lanternState = ref<LanternState>({
  room: roomDraft.value,
  lanterns: [],
  mineIds: [],
  policy: { ...FREE_LANTERN_POLICY },
});
const roomError = ref("");
const connectionText = computed(() =>
  presence.value.state === "connected"
    ? `${presence.value.count} / ${presence.value.capacity}`
    : presence.value.state === "full"
      ? "満員"
      : presence.value.state === "offline"
        ? "ひとりで散策"
        : "接続中",
);
function switchRoom() {
  const room = roomDraft.value.trim().toLowerCase();
  if (!validRoom(room)) {
    roomError.value = "半角英小文字・数字・_・-の1〜32文字で入力してください。";
    return;
  }
  if (game.value?.joinRoom(room)) {
    const url = new URL(location.href);
    url.searchParams.set("room", room);
    history.replaceState(null, "", url);
    roomDraft.value = room;
    roomError.value = "";
    roomOpen.value = false;
    notify(`${room} に入っています。`);
  }
}
async function copyInvite() {
  const url = new URL(location.href);
  url.searchParams.set("room", presence.value.room);
  try {
    await navigator.clipboard.writeText(url.toString());
    notify("同じルームへの招待リンクをコピーしました。");
  } catch {
    notify(
      `アドレスに ?room=${presence.value.room} を付けて共有してください。`,
    );
  }
}
const welcoming = ref(true);
const welcomeTimer = setTimeout(() => (welcoming.value = false), 8500);
const snapshot = ref<GameSnapshot>({
  nearby: null,
  state: "Idle",
  ritualStep: -1,
  ritualProgress: 0,
  player: { ...PLAYER_SPAWN },
  destination: null,
});
watch(
  () => snapshot.value.state,
  (state) => {
    if (state === "Walk") welcoming.value = false;
  },
);
const labels = ref<SceneLabel[]>([]);
const modal = ref<"help" | "fortune" | "ema" | "lantern" | null>(null);
const fortune = ref<Fortune>(drawFortune());
const visited = ref<InteractionId[]>([]);
const selected = ref<InteractionId>("offering");
const toast = ref("");
const dialog = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const places = [
  {
    id: "offering" as const,
    number: "01",
    japanese: "心を込めて、参拝",
    title: "心を込めて、参拝",
    description:
      "お賽銭箱の前へ進み、二礼二拍手一礼でお参りします。場所を選ぶと、自動で歩いて向かいます。",
    icon: "shrine",
    label: "拝殿",
    subtitle: "はいでん",
  },
  {
    id: "fortune" as const,
    number: "02",
    japanese: "今日の運だめし",
    title: "おみくじを引く",
    description:
      "拝殿の左手におみくじ箱があります。ひとつ引いて、今日の運勢をご覧ください。",
    icon: "fortune",
    label: "おみくじ",
    subtitle: "今日の運だめし",
  },
  {
    id: "ema" as const,
    number: "03",
    japanese: "小さな願いごと",
    title: "絵馬を見る",
    description:
      "拝殿の右手に絵馬掛けがあります。掛けられた願いをご覧いただけます。",
    icon: "ema",
    label: "絵馬",
    subtitle: "えま",
  },
  {
    id: "lantern" as const,
    number: "04",
    japanese: "小さな願いに、灯りを",
    title: "灯籠を掛ける",
    description:
      "右手の灯籠掛けで、願いを書いて灯籠を掛けられます。同じ境内にいる方と願いを共有します。現在は無料、今後は有料となる予定です。",
    icon: "lantern",
    label: "願いの灯",
    subtitle: "願いの灯籠",
  },
];
const selectedPlace = computed(() =>
  places.find((place) => place.id === selected.value)!,
);
const interactionText = computed(
  () =>
    ({
      offering: "参拝する",
      fortune: "おみくじを引く",
      ema: "絵馬を眺める",
      lantern: "灯りをともす",
    })[snapshot.value.nearby ?? selected.value],
);
const ritualText = computed(() =>
  snapshot.value.ritualStep < 0
    ? "参拝場所に向かっています"
    : RITUAL_STEPS[snapshot.value.ritualStep]?.label,
);
function notify(message: string) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 4200);
}
function markVisited(id: InteractionId) {
  if (!visited.value.includes(id)) visited.value.push(id);
}
function prayed() {
  markVisited("offering");
  notify("心を込めて、お参りしました。どうぞよい一日を。");
  selected.value = "fortune";
}
function openFortune() {
  fortune.value = drawFortune();
  modal.value = "fortune";
  markVisited("fortune");
}
function openEma() {
  modal.value = "ema";
  markVisited("ema");
}
function visit(id: InteractionId) {
  selected.value = id;
  guideOpen.value = false;
  game.value?.visit(id);
}
function reset() {
  modal.value = null;
  game.value?.reset();
  notify("鳥居の前から、もう一度散策を始めます。");
}
function labelName(id: string) {
  return places.find((place) => place.id === id)?.label;
}
function onDialogKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    modal.value = null;
    return;
  }
  if (event.key !== "Tab" || !dialog.value) return;
  const focusable = [
    ...dialog.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex="0"]',
    ),
  ];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === dialog.value)
  ) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
watch(modal, async (value, oldValue) => {
  if (value) {
    if (!oldValue) previousFocus = document.activeElement as HTMLElement | null;
  }
  await nextTick();
  if (modal.value !== value) return;
  if (value) dialog.value?.focus();
  else if (previousFocus?.isConnected) previousFocus.focus();
  else document.querySelector<HTMLButtonElement>(".help-button")?.focus();
});
onBeforeUnmount(() => {
  clearTimeout(toastTimer);
  clearTimeout(welcomeTimer);
});
</script>

<template>
  <div class="app-shell">
    <main class="experience" :inert="modal !== null" aria-label="こもれび神社の散策">
      <GameCanvas
        ref="game"
        :paused="modal !== null"
        @ready="ready = true"
        @update="snapshot = $event"
        @labels="labels = $event"
        @fortune="openFortune"
        @ema="openEma"
        @prayed="prayed"
        @notice="notify"
        @presence="presence = $event"
        @profile="profile = $event"
        @visitors="visitorLabels = $event"
        @lantern="modal = 'lantern'"
        @lanterns="lanternState = $event"
      />
      <div class="scene-vignette" aria-hidden="true"></div>
      <header class="experience-header">
        <div class="shrine-identity glass">
          <Icon name="shrine" :size="24" />
          <div><b>こもれび神社</b><span>木漏れ日の中で、ひと休み</span></div>
          <span class="identity-divider"></span
          ><button
            class="presence-toggle"
            :class="{ connected: presence.state === 'connected' }"
            :aria-expanded="roomOpen"
            aria-controls="room-panel"
            aria-label="ルームと参拝者を見る"
            @click="
              roomOpen = !roomOpen;
              guideOpen = false;
            "
          >
            <Icon name="users" :size="15" /><span>{{ connectionText }}</span>
          </button>
        </div>
        <div class="experience-tools glass">
          <button
            :aria-expanded="guideOpen"
            aria-label="境内案内をひらく"
            title="境内案内"
            @click="
              guideOpen = !guideOpen;
              roomOpen = false;
            "
          >
            <Icon name="compass" :size="20" />
          </button>
          <button aria-label="入口に戻る" title="入口に戻る" @click="reset">
            <Icon name="reset" :size="18" />
          </button>
          <button
            class="help-button"
            aria-label="楽しみ方"
            title="楽しみ方"
            @click="modal = 'help'"
          >
            <Icon name="help" :size="20" />
          </button>
        </div>
      </header>
      <SoundControls v-show="!guideOpen && !roomOpen" :dismissed="guideOpen || roomOpen || modal !== null" />
      <Transition name="fade">
        <aside
          v-if="roomOpen"
          id="room-panel"
          class="room-panel glass"
          aria-label="一緒に過ごすルーム"
        >
          <div class="guide-topline">
            <span>参拝者</span
            ><button aria-label="ルーム案内を閉じる" @click="roomOpen = false">
              <Icon name="close" :size="17" />
            </button>
          </div>
          <h2>
            {{ presence.room }}
            <small>{{ presence.count }} / {{ presence.capacity }}</small>
          </h2>
          <p v-if="presence.state === 'connected'">
            同じルームの方が、この境内に一緒に表示されます。
          </p>
          <p v-else-if="presence.state === 'full'">
            このルームは満員です。下から別のルームに入れます。
          </p>
          <p v-else>接続を待っています。それまではひとりで散策できます。</p>
          <ul class="visitor-list">
            <li>
              <span class="visitor-color self"></span>{{ presence.selfName
              }}<small>自分</small>
            </li>
            <li v-for="peer in presence.peers" :key="peer.id">
              <span
                class="visitor-color"
                :style="{ background: peer.tint }"
              ></span
              >{{ peer.name }}
            </li>
          </ul>
          <section
            v-if="profile"
            class="visitor-history"
            aria-label="私のあしあと"
          >
            <div class="visitor-history-heading">
              <span>参拝の記録</span><small>このブラウザーでの記録</small>
            </div>
            <dl>
              <div>
                <dt>訪問</dt>
                <dd>{{ profile.visitCount }}<small>回</small></dd>
              </div>
              <div>
                <dt>参拝</dt>
                <dd>{{ profile.prayerCount }}<small>回</small></dd>
              </div>
              <div>
                <dt>灯した灯籠</dt>
                <dd>{{ profile.lanternHangCount }}<small>灯</small></dd>
              </div>
            </dl>
            <small>境内で過ごした時間 {{ connectedTime }}</small>
          </section>
          <button class="invite-button" @click="copyInvite">
            <Icon name="link" :size="16" /> 招待リンクをコピー
          </button>
          <form class="room-form" @submit.prevent="switchRoom">
            <label for="room-name">ルーム名で入る</label>
            <div>
              <input
                id="room-name"
                v-model="roomDraft"
                maxlength="32"
                autocapitalize="none"
                autocomplete="off"
                spellcheck="false"
                aria-describedby="room-hint"
              /><button type="submit">入る</button>
            </div>
            <small id="room-hint"
              >同じ名前を入力すると、同じ境内に集まれます。</small
            >
            <p v-if="roomError" class="room-error" role="alert">
              {{ roomError }}
            </p>
          </form>
        </aside>
      </Transition>
      <div
        v-for="visitor in visitorLabels"
        v-show="visitor.visible"
        :key="visitor.id"
        class="visitor-name glass"
        :style="{ left: `${visitor.x}px`, top: `${visitor.y}px` }"
      >
        <span></span>{{ visitor.name }}
      </div>
      <Transition name="fade"
        ><div v-if="welcoming" class="arrival-note glass">
          <span>木漏れ日に、ひと休み。</span>
          <p>木々のあいだから差す光の下で、ひと休み。</p>
        </div></Transition
      >
      <div class="movement-instruction" :class="{ settled: !welcoming }">
        <span class="desktop-instruction"
          >地面をクリックして歩く <i>·</i> ドラッグで見渡す
          <i>·</i> ホイールで距離を調節</span
        ><span class="mobile-instruction"
          >地面をタップして歩く・スワイプで見渡す</span
        >
      </div>
      <Transition name="fade">
        <aside
          v-if="guideOpen"
          class="shrine-guide glass"
          aria-label="境内案内"
        >
          <div class="guide-topline">
            <span>境内案内</span
            ><button aria-label="境内案内を閉じる" @click="guideOpen = false">
              <Icon name="close" :size="17" />
            </button>
          </div>
          <h2>
            {{ selectedPlace.label }}
            <small>{{ selectedPlace.subtitle }}</small>
          </h2>
          <p>{{ selectedPlace.description }}</p>
          <nav aria-label="境内の場所">
            <button
              v-for="place in places"
              :key="place.id"
              :class="{ selected: selected === place.id }"
              :disabled="snapshot.state === 'Pray'"
              @click="visit(place.id)"
            >
              <Icon
                :name="visited.includes(place.id) ? 'check' : place.icon"
                :size="20"
              /><span>{{ place.title }}</span
              ><Icon name="arrow" :size="16" />
            </button>
          </nav>
          <small class="guide-footnote">場所を選ぶと、歩いて向かいます。</small>
        </aside>
      </Transition>
      <template v-if="ready">
        <button
          v-for="label in labels"
          v-show="label.visible"
          :key="label.id"
          class="scene-label glass"
          :class="{ nearby: snapshot.nearby === label.id }"
          :style="{ left: `${label.x}px`, top: `${label.y}px` }"
          :disabled="snapshot.state === 'Pray' || modal !== null"
          :aria-label="`${labelName(label.id)}へ向かう`"
          @click="visit(label.id as InteractionId)"
        >
          <span class="label-dot"></span>{{ labelName(label.id)
          }}<Icon
            v-if="visited.includes(label.id as InteractionId)"
            name="check"
            :size="12"
          />
        </button>
        <div class="interaction-dock">
          <Transition name="fade" mode="out-in">
            <div
              v-if="snapshot.state === 'Pray'"
              class="ritual-card glass"
              key="praying"
              role="status"
            >
              <div class="ritual-heading">
                <Icon name="shrine" :size="20" /><span>二礼二拍手一礼</span
                ><small>{{ ritualText }}</small>
              </div>
              <div class="ritual-steps">
                <span
                  v-for="(step, index) in RITUAL_STEPS"
                  :key="index"
                  :class="{
                    current: snapshot.ritualStep === index,
                    done: snapshot.ritualStep > index,
                  }"
                  ><Icon
                    v-if="snapshot.ritualStep > index"
                    name="check"
                    :size="11"
                  /><template v-else>{{ index + 1 }}</template
                  ><small>{{
                    step.kind === "bow" ? "礼" : "拍手"
                  }}</small></span
                >
              </div>
              <div class="ritual-track">
                <span
                  :style="{ width: `${snapshot.ritualProgress * 100}%` }"
                ></span>
              </div>
            </div>
            <button
              v-else-if="snapshot.nearby && !snapshot.destination"
              class="interact-button glass"
              key="nearby"
              @click="game?.interact()"
            >
              <Icon
                :name="
                  places.find((p) => p.id === snapshot.nearby)?.icon ?? 'shrine'
                "
                :size="19"
              /><span>{{ interactionText }}</span
              ><kbd>E</kbd>
            </button>
            <div
              v-else-if="snapshot.destination"
              class="walking-to glass"
              key="destination"
              role="status"
            >
              <span class="walking-dot"></span
              >{{ labelName(snapshot.destination) }}へ歩いています<span
                class="walking-cancel"
                >移動キーで中止</span
              >
            </div>
          </Transition>
        </div>
        <nav class="experience-actions glass" aria-label="境内でできること">
          <button
            v-for="place in places"
            :key="place.id"
            :disabled="snapshot.state === 'Pray' || modal !== null"
            :class="{
              active:
                snapshot.destination === place.id ||
                snapshot.nearby === place.id,
              completed: visited.includes(place.id),
            }"
            :title="`${place.title}・近くまで歩いて体験する`"
            @click="visit(place.id)"
          >
            <span class="action-icon"
              ><Icon :name="place.icon" :size="25" /><span
                v-if="visited.includes(place.id)"
                class="completion-dot"
              ></span></span
            ><span>{{
              place.id === "offering"
                ? "参拝する"
                : place.id === "fortune"
                  ? "おみくじ"
                  : place.id === "lantern"
                    ? "灯籠"
                    : "絵馬"
            }}</span
            ><small>{{
              place.id === "offering"
                ? "二礼二拍手一礼"
                : place.id === "fortune"
                  ? "今日の運勢"
                  : place.id === "lantern"
                    ? "願いを灯す"
                    : "願いを読む"
            }}</small>
          </button>
        </nav>
        <div class="touch-controls">
          <TouchJoystick
            :disabled="snapshot.state === 'Pray' || modal !== null"
            @move="(x, y) => game?.touch(x, y)"
          /><button
            class="touch-action glass"
            :disabled="
              !snapshot.nearby || snapshot.state === 'Pray' || modal !== null
            "
            aria-label="近くの場所で体験する"
            @click="game?.interact()"
          >
            <Icon name="shrine" :size="24" /><span>体験する</span>
          </button>
        </div>
        <div class="experience-footnote">
          <span class="desktop-instruction"
            ><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd
            ><kbd>D</kbd> または矢印キーでも歩けます</span
          ><span class="mobile-instruction">どうぞ、ごゆっくり。</span>
        </div>
        <div class="visit-journal">
          <Icon name="leaf" :size="14" /><span>小さな思い出</span>
          {{ visited.length }} <span>/ {{ places.length }}</span>
        </div>
      </template>
      <div v-else class="loading-overlay">
        <Icon name="shrine" :size="38" />
        <p>木々の向こうに、境内をひらいています…</p>
      </div>
      <Transition name="toast"
        ><div v-if="toast" class="toast-message glass" role="status">
          <Icon name="leaf" :size="17" />{{ toast }}
        </div></Transition
      >
    </main>

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="modal" class="modal-backdrop" @click.self="modal = null">
          <section
            ref="dialog"
            class="modal-dialog"
            :class="{
              'fortune-dialog': modal === 'fortune',
              'lantern-dialog': modal === 'lantern',
              'ema-dialog': modal === 'ema',
            }"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            tabindex="-1"
            @keydown="onDialogKey"
          >
            <button
              class="modal-close"
              aria-label="閉じる"
              @click="modal = null"
            >
              <span>閉じる</span><Icon name="close" :size="16" />
            </button>
            <LanternPanel
              v-if="modal === 'lantern'"
              :state="lanternState"
              :connected="presence.state === 'connected'"
              :hang="
                async (productId, wish, signature, slot) =>
                  game?.hangLantern(productId, wish, signature, slot)
              "
              :remove="async (id) => game?.removeLantern(id)"
              @placed="markVisited('lantern')"
              @close="modal = null"
            />
            <template v-else-if="modal === 'help'">
              <div class="eyebrow">こもれび神社</div>
              <h2 id="dialog-title">境内の歩き方</h2>
              <p class="modal-intro">
                参道を歩き、拝殿へ。<br />どうぞ、ご自由にお過ごしください。
              </p>
              <div class="help-list">
                <div>
                  <span>01</span>
                  <p>
                    <strong>歩く</strong
                    >地面をクリック・タップすると、そこまで歩きます。WASD・矢印キー、またはタッチジョイスティックでも移動できます。
                  </p>
                </div>
                <div>
                  <span>02</span>
                  <p>
                    <strong>参拝・授与所</strong
                    >下のメニューから参拝・おみくじ・絵馬・灯籠を選ぶと、その場所へ歩いて向かいます。近くではEキーや画面のボタンでも体験できます。
                  </p>
                </div>
                <div>
                  <span>03</span>
                  <p>
                    <strong>見渡す</strong
                    >ドラッグで見渡し、ホイールや2本指で距離を調節できます。右上の戻るボタンで入口から歩き直せます。
                  </p>
                </div>
              </div>
              <button class="primary-button" @click="modal = null">
                境内に戻る<Icon name="arrow" :size="18" />
              </button>
            </template>
            <template v-else-if="modal === 'fortune'">
              <div class="eyebrow fortune-caption"><span>こもれび神社</span><span>御神籤</span></div>
              <h2 id="dialog-title" class="fortune-title">
                {{ fortune.title }}
              </h2>
              <span class="fortune-reading">{{ fortune.reading }}</span>
              <div class="fortune-rule" aria-hidden="true"><span></span></div>
              <h3>{{ fortune.message }}</h3>
              <p class="fortune-description">{{ fortune.detail }}</p>
              <dl class="fortune-details">
                <div>
                  <dt>願いごと</dt>
                  <dd>{{ fortune.wish }}</dd>
                </div>
                <div>
                  <dt>幸運の色</dt>
                  <dd>{{ fortune.color }}</dd>
                </div>
                <div>
                  <dt>おすすめ</dt>
                  <dd>{{ fortune.item }}</dd>
                </div>
              </dl>
              <p class="fortune-footnote">
                運勢は、日々の心がけの参考に。
              </p>
              <button class="primary-button" @click="modal = null">
                境内に戻る<Icon name="arrow" :size="17" />
              </button>
            </template>
            <template v-else>
              <div class="eyebrow">こもれび神社</div>
              <h2 id="dialog-title">絵馬に託す願い</h2>
              <p class="modal-intro">
                絵馬掛けに寄せられた願いをご覧ください。
              </p>
              <div class="ema-wishes">
                <blockquote>
                  <span class="ema-category">家内安全</span>家族が健やかに暮らせますように。
                </blockquote>
                <blockquote>
                  <span class="ema-category">学業成就</span>学びが実を結びますように。
                </blockquote>
                <blockquote>
                  <span class="ema-category">無病息災</span>穏やかな日々が続きますように。
                </blockquote>
              </div>
              <p class="fortune-footnote">展示用の絵馬です。実際の投稿ではありません。</p>
              <button class="primary-button" @click="modal = null">
                境内に戻る<Icon name="arrow" :size="18" />
              </button>
            </template>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
