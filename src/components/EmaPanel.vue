<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Icon from "./Icon.vue";
import {
  LANTERN_PRODUCTS,
  MAX_WISH_LENGTH,
  MAX_SIGNATURE_LENGTH,
  lanternProduct,
  type LanternState,
} from "../shared/lanterns";
import { wishProblem } from "../shared/moderation";

type Result = Promise<{ ok: boolean; message: string } | undefined>;
const props = defineProps<{
  state: LanternState;
  connected: boolean;
  hang: (
    productId: string,
    wish: string,
    signature: string,
    slot: number | null,
  ) => Result;
  remove: (id: string) => Result;
  report: (id: string) => Result;
}>();
const emit = defineEmits<{ placed: []; close: [] }>();
const productId = ref<string>(LANTERN_PRODUCTS[0].id),
  wish = ref(""),
  signature = ref(""),
  consent = ref(false),
  busy = ref(false),
  feedback = ref(""),
  success = ref(false),
  confirmReport = ref(false);
const reported = ref<string[]>([]);
const selectedSlot = ref<number | null>(null);
const open = computed(() => props.state.policy.mode === "free");
const mine = computed(() =>
  props.state.lanterns.find((item) => props.state.mineIds.includes(item.id)),
);
const selected = computed(() =>
  props.state.lanterns.find((item) => item.slot === selectedSlot.value),
);
const writing = computed(() => !selected.value && !mine.value && open.value);
const design = computed(() =>
  lanternProduct(selected.value?.productId ?? productId.value)!,
);
const previewText = computed(() =>
  selected.value ? selected.value.wish : wish.value.trim(),
);
const previewName = computed(() =>
  selected.value ? selected.value.signature : signature.value.trim(),
);
const count = computed(() => Array.from(wish.value).length);
const problem = computed(
  () => wishProblem(wish.value) ?? wishProblem(signature.value),
);
const freeSlot = computed(
  () =>
    Array.from({ length: props.state.policy.capacity }, (_, i) => i).find(
      (i) => !props.state.lanterns.some((item) => item.slot === i),
    ) ?? null,
);
watch(
  () => props.state.room,
  () => {
    selectedSlot.value = null;
    feedback.value = "";
  },
);
watch(
  [mine, freeSlot],
  () => {
    if (selectedSlot.value === null)
      selectedSlot.value = mine.value?.slot ?? freeSlot.value;
  },
  { immediate: true },
);
watch(selectedSlot, () => (confirmReport.value = false));
function date(value: number) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
async function run(action: () => Result, fallback: string) {
  busy.value = true;
  feedback.value = "";
  try {
    const result = await action();
    success.value = Boolean(result?.ok);
    feedback.value = result?.message ?? "しばらくしてからお試しください。";
    return result;
  } catch {
    success.value = false;
    feedback.value = fallback;
  } finally {
    busy.value = false;
  }
}
async function hang() {
  if (busy.value || !props.connected || !consent.value || !open.value) return;
  if (problem.value) {
    success.value = false;
    feedback.value = problem.value;
    return;
  }
  const result = await run(
    () =>
      props.hang(productId.value, wish.value, signature.value, selectedSlot.value),
    "絵馬を掛けられませんでした。接続を確認してからお試しください。",
  );
  if (result?.ok) {
    wish.value = "";
    consent.value = false;
    emit("placed");
  }
}
async function remove() {
  if (busy.value || !mine.value) return;
  const id = mine.value.id;
  const result = await run(
    () => props.remove(id),
    "絵馬を外せませんでした。もう一度お試しください。",
  );
  if (result?.ok) selectedSlot.value = null;
}
async function report() {
  const target = selected.value;
  if (busy.value || !target) return;
  const result = await run(
    () => props.report(target.id),
    "お知らせを送れませんでした。もう一度お試しください。",
  );
  confirmReport.value = false;
  if (result?.ok) reported.value.push(target.id);
}
</script>
<template>
  <div class="lantern-panel ema-panel">
    <div class="eyebrow">こもれび神社 · 絵馬掛所</div>
    <h2 id="dialog-title">絵馬に願いを</h2>
    <p class="lantern-intro">
      絵柄を選び、願いをひとつ書いて、絵馬掛けに結びます。
    </p>
    <div class="lantern-policy">
      <span>{{ state.policy.durationHours }}時間、掛けられます</span
      ><span>このルームにおひとり1枚</span>
    </div>
    <div class="lantern-content">
      <div class="lantern-preview-column">
        <div
          class="ema-preview"
          :style="{ '--ema-color': design.color }"
          aria-hidden="true"
        >
          <span class="ema-cord"></span>
          <div class="ema-plaque">
            <span class="ema-picture">願</span>
            <p class="ema-writing">
              {{ previewText || "願いごと" }}
            </p>
            <small v-if="previewName" class="ema-name">{{ previewName }}</small>
          </div>
        </div>
        <div class="lantern-board-heading">
          <span>掛ける場所</span
          ><small
            >{{ state.lanterns.length }} / {{ state.policy.capacity }}</small
          >
        </div>
        <div class="lantern-slot-grid" aria-label="絵馬を掛ける場所を選ぶ">
          <button
            v-for="slot in state.policy.capacity"
            :key="slot"
            :disabled="busy"
            :class="{
              selected: selectedSlot === slot - 1,
              occupied: state.lanterns.some((item) => item.slot === slot - 1),
              mine: state.lanterns.some(
                (item) =>
                  item.slot === slot - 1 && state.mineIds.includes(item.id),
              ),
            }"
            :aria-label="`${slot}番の場所 ${state.lanterns.some((item) => item.slot === slot - 1) ? '願いを読む' : '選ぶ'}`"
            :aria-pressed="selectedSlot === slot - 1"
            @click="
              selectedSlot = slot - 1;
              feedback = '';
            "
          >
            <Icon name="ema" :size="16" />
          </button>
        </div>
        <small class="lantern-board-note"
          >掛かっている絵馬を選ぶと、その願いを読めます。<br />空いた場所にご自身の絵馬を掛けられます。</small
        >
      </div>
      <div class="lantern-writing-column">
        <div v-if="!connected" class="lantern-feedback" role="status">
          境内につながると、絵馬を掛けたり外したりできます。
        </div>
        <article v-if="selected" class="lantern-wish-card">
          <span class="eyebrow">{{
            state.mineIds.includes(selected.id)
              ? "私の絵馬"
              : "この境内に掛かる願い"
          }}</span>
          <blockquote>{{ selected.wish }}</blockquote>
          <span class="wish-signature">— {{ selected.signature }}</span>
          <small>{{ date(selected.expiresAt) }}まで掛かっています。</small>
          <button
            v-if="state.mineIds.includes(selected.id)"
            type="button"
            class="lantern-remove"
            :disabled="busy || !connected"
            @click="remove"
          >
            {{ busy ? "少しお待ちください…" : "自分の絵馬を外す" }}
          </button>
          <template v-else>
            <button
              v-if="!mine && freeSlot !== null && open"
              type="button"
              class="lantern-text-button"
              @click="selectedSlot = freeSlot"
            >
              私も絵馬を書く <Icon name="arrow" :size="14" />
            </button>
            <div class="ema-report">
              <span v-if="reported.includes(selected.id)"
                >お知らせを受け付けました。</span
              >
              <template v-else-if="confirmReport">
                <span>不適切な内容としてお知らせしますか？</span>
                <button
                  type="button"
                  :disabled="busy || !connected"
                  @click="report"
                >
                  お知らせする
                </button>
                <button type="button" @click="confirmReport = false">
                  やめる
                </button>
              </template>
              <button
                v-else
                type="button"
                class="ema-report-open"
                :disabled="!connected"
                @click="confirmReport = true"
              >
                <Icon name="flag" :size="13" /> 不適切な内容を知らせる
              </button>
            </div>
          </template>
        </article>
        <div v-else-if="mine" class="lantern-wish-card">
          <Icon name="ema" :size="27" />
          <h3>あなたの絵馬は、すでに掛かっています。</h3>
          <p>このルームでは、ひとつの願いを掛けられます。</p>
          <button class="lantern-text-button" @click="selectedSlot = mine.slot">
            自分の絵馬を見る <Icon name="arrow" :size="14" />
          </button>
        </div>
        <div v-else-if="!open" class="lantern-wish-card">
          <Icon name="ema" :size="27" />
          <h3>ただいま絵馬の奉納をお休みしています。</h3>
          <p>
            掛かっている絵馬は、引き続きご覧いただけます。ご自身の絵馬の確認・取り外しもできます。
          </p>
        </div>
        <form v-if="writing" class="lantern-form" @submit.prevent="hang">
          <fieldset :disabled="busy">
            <legend>絵柄</legend>
            <div class="lantern-designs">
              <button
                v-for="item in LANTERN_PRODUCTS"
                :key="item.id"
                type="button"
                :disabled="item.availability !== 'available'"
                :aria-pressed="productId === item.id"
                :class="{ selected: productId === item.id }"
                :title="item.subtitle"
                @click="productId = item.id"
              >
                <i :style="{ background: item.color }"></i
                ><span>{{ item.name }}</span>
              </button>
            </div>
          </fieldset>
          <label for="ema-wish"
            >願いごと
            <small>{{ count }} / {{ MAX_WISH_LENGTH }}</small></label
          >
          <textarea
            id="ema-wish"
            v-model="wish"
            rows="3"
            :maxlength="MAX_WISH_LENGTH * 2"
            placeholder="大切な人が、健やかでありますように。"
            required
            :disabled="busy"
            :aria-invalid="Boolean(problem)"
            aria-describedby="ema-public-note ema-problem"
          ></textarea>
          <label for="ema-signature">お名前 <small>任意</small></label
          ><input
            id="ema-signature"
            v-model="signature"
            :maxlength="MAX_SIGNATURE_LENGTH"
            placeholder="省略できます"
            :disabled="busy"
            autocomplete="off"
          />
          <p v-if="problem" id="ema-problem" class="ema-problem" role="alert">
            {{ problem }}
          </p>
          <label class="lantern-consent"
            ><input
              v-model="consent"
              type="checkbox"
              :disabled="busy"
              required
            /><span id="ema-public-note"
              >願いとお名前は、同じルームの方に公開されます。</span
            ></label
          >
          <button
            type="submit"
            class="primary-button lantern-submit"
            :disabled="
              busy ||
              !connected ||
              !consent ||
              !wish.trim() ||
              count > MAX_WISH_LENGTH ||
              Boolean(problem) ||
              selectedSlot === null
            "
          >
            {{ busy ? "願いを込めています…" : "絵馬を掛ける"
            }}<Icon name="ema" :size="19" />
          </button>
        </form>
        <p
          v-if="feedback"
          class="lantern-feedback"
          :class="{ success }"
          role="status"
          aria-live="polite"
        >
          {{ feedback }}
        </p>
      </div>
    </div>
    <p class="lantern-footer">
      絵馬は期限を迎えると外されます。同じブラウザーで、ご自身の絵馬を管理できます。<br />ほかの方を傷つける内容や連絡先は書けません。
    </p>
    <button type="button" class="lantern-return" @click="emit('close')">
      境内に戻る <Icon name="arrow" :size="16" />
    </button>
  </div>
</template>
