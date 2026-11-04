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
const props = defineProps<{
  state: LanternState;
  connected: boolean;
  hang: (
    productId: string,
    wish: string,
    signature: string,
    slot: number | null,
  ) => Promise<{ ok: boolean; message: string } | undefined>;
  remove: (id: string) => Promise<{ ok: boolean; message: string } | undefined>;
}>();
const emit = defineEmits<{ placed: []; close: [] }>();
const productId = ref("paper-warm"),
  wish = ref(""),
  signature = ref(""),
  consent = ref(false),
  busy = ref(false),
  feedback = ref(""),
  success = ref(false);
const selectedSlot = ref<number | null>(null);
const mine = computed(() =>
  props.state.lanterns.find((item) => props.state.mineIds.includes(item.id)),
);
const selected = computed(() =>
  props.state.lanterns.find((item) => item.slot === selectedSlot.value),
);
const product = computed(() =>
  lanternProduct(selected.value?.productId ?? productId.value)!,
);
const count = computed(() => Array.from(wish.value).length);
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
function date(value: number) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
async function hang() {
  if (
    busy.value ||
    !props.connected ||
    !consent.value ||
    props.state.policy.mode !== "free"
  )
    return;
  busy.value = true;
  feedback.value = "";
  try {
    const result = await props.hang(
      productId.value,
      wish.value,
      signature.value,
      selectedSlot.value,
    );
    success.value = Boolean(result?.ok);
    feedback.value = result?.message ?? "しばらくしてからお試しください。";
    if (result?.ok) {
      wish.value = "";
      consent.value = false;
      emit("placed");
    }
  } catch {
    success.value = false;
    feedback.value =
      "灯籠をかけられませんでした。接続を確認してからお試しください。";
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (busy.value || !mine.value) return;
  busy.value = true;
  feedback.value = "";
  try {
    const result = await props.remove(mine.value.id);
    success.value = Boolean(result?.ok);
    feedback.value = result?.message ?? "しばらくしてからお試しください。";
    if (result?.ok) selectedSlot.value = null;
  } catch {
    success.value = false;
    feedback.value = "灯籠を取り下げられませんでした。もう一度お試しください。";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="lantern-panel">
    <div class="eyebrow">こもれび神社 · 灯籠掛け</div>
    <h2 id="dialog-title">願いを記す</h2>
    <p class="lantern-intro">
      灯りを選び、願いをひとつお書きください。
    </p>
    <div class="lantern-policy">
      <span>{{
        state.policy.mode === "free"
          ? "現在は無料"
          : "無料体験は終了しました"
      }}</span
      ><span>{{ state.policy.durationHours }}時間、灯ります</span
      ><span>このルームにおひとり1灯</span>
    </div>
    <div class="lantern-content">
      <div class="lantern-preview-column">
        <div
          class="paper-lantern-preview"
          :style="{ '--lantern-color': product.color }"
        >
          <span class="lantern-thread"></span>
          <div class="paper-lantern"><span>願</span></div>
          <span class="lantern-tassel"></span>
        </div>
        <div class="lantern-board-heading">
          <span>掛ける場所</span
          ><small
            >{{ state.lanterns.length }} / {{ state.policy.capacity }}</small
          >
        </div>
        <div class="lantern-slot-grid" aria-label="灯籠をかける場所を選ぶ">
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
            <Icon name="lantern" :size="18" />
          </button>
        </div>
        <small class="lantern-board-note"
          >灯籠を選ぶと、その願いを読めます。<br />空いた場所にご自身の灯籠を掛けられます。</small
        >
      </div>
      <div class="lantern-writing-column">
        <div v-if="!connected" class="lantern-feedback" role="status">
          境内につながると、灯籠をかけたり取り下げたりできます。
        </div>
        <article v-if="selected" class="lantern-wish-card">
          <span class="eyebrow">{{
            state.mineIds.includes(selected.id)
              ? "私の灯籠"
              : "この境内に灯る願い"
          }}</span>
          <blockquote>{{ selected.wish }}</blockquote>
          <span class="wish-signature">— {{ selected.signature }}</span>
          <small>{{ date(selected.expiresAt) }}まで灯ります。</small>
          <button
            v-if="state.mineIds.includes(selected.id)"
            type="button"
            class="lantern-remove"
            :disabled="busy || !connected"
            @click="remove"
          >
            {{ busy ? "少しお待ちください…" : "自分の灯籠を取り下げる" }}
          </button>
          <button
            v-else-if="!mine && freeSlot !== null"
            type="button"
            class="lantern-text-button"
            @click="selectedSlot = freeSlot"
          >
            私も願いを込める <Icon name="arrow" :size="14" />
          </button>
        </article>
        <div v-else-if="mine" class="lantern-wish-card">
          <Icon name="lantern" :size="27" />
          <h3>あなたの灯籠は、すでに灯っています。</h3>
          <p>このルームでは、ひとつの願いを灯せます。</p>
          <button class="lantern-text-button" @click="selectedSlot = mine.slot">
            自分の灯籠を見る <Icon name="arrow" :size="14" />
          </button>
        </div>
        <div v-else-if="state.policy.mode === 'paid'" class="lantern-wish-card">
          <Icon name="lantern" :size="27" />
          <h3>有料での掲灯を準備しています。</h3>
          <p>
            灯籠の無料体験は終了しました。新しい灯りをかけられる日まで、少しお待ちください。
            すでにかけた灯籠は、引き続き確認・取り下げができます。
          </p>
        </div>
        <form v-else class="lantern-form" @submit.prevent="hang">
          <fieldset :disabled="busy">
            <legend>灯りの色</legend>
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
                ><span>{{ item.name }}</span
                ><small v-if="item.availability !== 'available'">準備中</small>
              </button>
            </div>
          </fieldset>
          <label for="lantern-wish"
            >願いごと
            <small>{{ count }} / {{ MAX_WISH_LENGTH }}</small></label
          >
          <textarea
            id="lantern-wish"
            v-model="wish"
            rows="3"
            :maxlength="MAX_WISH_LENGTH * 2"
            placeholder="大切な人が、健やかでありますように。"
            required
            :disabled="busy"
            aria-describedby="lantern-public-note"
          ></textarea>
          <label for="lantern-signature">お名前 <small>任意</small></label
          ><input
            id="lantern-signature"
            v-model="signature"
            :maxlength="MAX_SIGNATURE_LENGTH"
            placeholder="省略できます"
            :disabled="busy"
            autocomplete="off"
          />
          <label class="lantern-consent"
            ><input
              v-model="consent"
              type="checkbox"
              :disabled="busy"
              required
            /><span id="lantern-public-note"
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
              selectedSlot === null
            "
          >
            {{ busy ? "願いを込めています…" : "無料で灯籠をかける"
            }}<Icon name="lantern" :size="19" />
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
      散策と参拝は無料で楽しめます。灯籠は無料体験のあと、有料へ切り替える
      予定です。<br />灯籠は期限を迎えると取り下げられます。同じブラウザーで、ご自身の灯籠を
      管理できます。
    </p>
    <button type="button" class="lantern-return" @click="emit('close')">境内に戻る <Icon name="arrow" :size="16" /></button>
  </div>
</template>
