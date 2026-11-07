<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import type { ShrineAudio } from "../audio/ShrineAudio";

const props = defineProps<{ href: string; audio: ShrineAudio }>();
const emit = defineEmits<{ close: [] }>();
const phase = ref<"ready" | "tossing" | "settled">("ready");
const reducedMotion = ref(false);
const coinButton = ref<HTMLButtonElement>();
const supportLink = ref<HTMLAnchorElement>();
const id = useId();
const noticeId = `offering-notice-${id}`;
const statusId = `offering-status-${id}`;
const externalNoteId = `offering-external-${id}`;
let motionPreference: MediaQueryList | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let cancelSound: (() => void) | undefined;
let disposed = false;
let focusAfterToss = false;

async function settle(focus = true) {
  clearTimeout(timer);
  timer = undefined;
  if (disposed || phase.value !== "tossing") return;
  phase.value = "settled";
  await nextTick();
  if (disposed || !focus || !focusAfterToss || document.hidden) return;
  // Do not steal focus if the visitor has already moved to the close button.
  if (document.activeElement === coinButton.value || document.activeElement === document.body)
    supportLink.value?.focus({ preventScroll: true });
}

function offer() {
  if (disposed || phase.value !== "ready") return;
  focusAfterToss = document.activeElement === coinButton.value;
  phase.value = "tossing";
  cancelSound = props.audio.playOffering(reducedMotion.value);
  if (reducedMotion.value) void settle();
  else timer = setTimeout(() => void settle(), 680);
}

function onMotionChange(event: MediaQueryListEvent) {
  reducedMotion.value = event.matches;
  if (event.matches && phase.value === "tossing") {
    cancelSound?.();
    void settle();
  }
}
function onVisibility() {
  if (!document.hidden) return;
  cancelSound?.();
  // A background tab must not replay the toss or move focus when it returns.
  if (phase.value === "tossing") void settle(false);
}
function cancel() {
  disposed = true;
  clearTimeout(timer);
  cancelSound?.();
  motionPreference?.removeEventListener("change", onMotionChange);
  document.removeEventListener("visibilitychange", onVisibility);
}
function close() {
  cancel();
  emit("close");
}
onMounted(() => {
  if (disposed) return;
  motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion.value = motionPreference.matches;
  motionPreference.addEventListener("change", onMotionChange);
  document.addEventListener("visibilitychange", onVisibility);
});
defineExpose({ cancel });
onBeforeUnmount(cancel);
</script>

<template>
  <div class="offering-experience" :data-phase="phase" :class="{ 'offering-reduced': reducedMotion }">
    <p class="offering-shrine-name">こもれび神社</p>
    <h2 id="dialog-title">お賽銭</h2>
    <p class="offering-intro">こもれび神社の制作・運営を、<br />OFUSEで応援できます。</p>
    <p :id="noticeId" class="offering-notice">五円玉は演出です。ご支援は100円から、<br class="offering-desktop-break" />金額はOFUSEでお選びいただけます。</p>

    <div class="offering-scene">
      <svg class="offering-box" viewBox="0 0 320 170" fill="none" aria-hidden="true">
        <path d="M28 49 82 21H285L235 54Z" fill="#b28d60" stroke="#795c3d" />
        <path d="M28 49 235 54V151L28 132Z" fill="#8a6746" stroke="#624b35" />
        <path d="M235 54 285 21V119L235 151Z" fill="#695039" stroke="#513f2e" />
        <path d="M23 46 79 15H291V28L237 62 23 57Z" fill="#c49b69" stroke="#795c3d" />
        <path d="M23 46 237 50 291 15M237 50V62" stroke="#e2bd89" stroke-opacity=".65" />
        <path d="M54 41 94 23H260L227 45Z" fill="#3e3327" />
        <g stroke="#c49b69" stroke-width="10">
          <path d="m80 43 39-20m-8 21 39-21m-8 22 39-22m-8 22 39-22m-8 23 39-23" />
        </g>
        <path d="M38 70C77 75 121 69 164 76s56 3 62 5M37 84c39 7 76 0 111 5s50 0 78 6M36 113c53-5 80 8 113 4s49 5 75 3M244 74l30-21m-30 43 30-21m-30 42 30-21" stroke="#402f21" stroke-opacity=".17" />
        <path d="M46 65v66m170-61v74" stroke="#aa8156" stroke-width="10" />
        <path d="M39 126 225 143v8L39 134Z" fill="#654b32" />
        <rect x="109" y="84" width="51" height="31" rx="1" fill="#cfb582" stroke="#6d5137" />
        <text x="134.5" y="105" class="offering-box-label">奉 納</text>
        <g fill="#5f4a34">
          <circle cx="47" cy="75" r="2" /><circle cx="47" cy="119" r="2" />
          <circle cx="215" cy="80" r="2" /><circle cx="215" cy="134" r="2" />
        </g>
      </svg>

      <button
        ref="coinButton"
        class="offering-coin-button"
        type="button"
        :disabled="phase !== 'ready'"
        :aria-describedby="`${noticeId} ${statusId}`"
        data-offering-initial-focus
        @click="offer"
      >
        <svg class="offering-coin" viewBox="0 0 120 120" fill="none" aria-hidden="true">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M113 60a53 53 0 1 1-106 0 53 53 0 0 1 106 0ZM72 60a12 12 0 1 0-24 0 12 12 0 0 0 24 0Z" fill="#b79a53" />
          <path fill-rule="evenodd" clip-rule="evenodd" d="M109 59a50 50 0 1 1-100 0 50 50 0 0 1 100 0ZM72 60a12 12 0 1 0-24 0 12 12 0 0 0 24 0Z" fill="#c9af69" />
          <circle cx="60" cy="60" r="47" stroke="#e3ce91" stroke-width="1.4" />
          <circle cx="60" cy="60" r="13.8" stroke="#8e763e" stroke-width="1.4" />
          <path d="M17 70c11-7 13-23 12-42m-2 8-7-5m8 11-9-3m8 10-10-1m9 7-10 3m11-7 8-6m-9-1 8-7m-7-1 7-7m-6-1 5-5" stroke="#8e763e" stroke-width="1.35" stroke-linecap="round" />
          <path d="M80 43h19M79 48h23M79 53h24M80 58h22M80 63h20M79 68h18" stroke="#9a8148" stroke-width="1.15" />
          <text x="60" y="93" class="offering-coin-letter">五 円</text>
          <path d="M24 22a49 49 0 0 1 64-1" stroke="#eee0b4" stroke-opacity=".6" stroke-width="1.2" />
        </svg>
        <span class="offering-coin-caption">五円玉を納める</span>
      </button>
    </div>

    <p :id="statusId" class="offering-status" role="status" aria-live="polite" aria-atomic="true">
      <template v-if="phase === 'ready'">五円玉を押して、お賽銭箱へ。</template>
      <template v-else-if="phase === 'tossing'">五円玉を納めています。</template>
      <template v-else>続けてOFUSEをひらけます。</template>
    </p>

    <div class="offering-actions">
      <template v-if="phase === 'settled'">
        <a
          ref="supportLink"
          class="primary-button offering-support-link"
          :href="href"
          target="_blank"
          rel="noopener noreferrer"
          :aria-describedby="`${noticeId} ${externalNoteId}`"
        >
          OFUSEで応援する
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M14 4h6v6m-1-5-9 9M10 5H5v14h14v-5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
        <span :id="externalNoteId" class="offering-external-note">別のタブで開きます</span>
      </template>
      <button class="offering-return" type="button" @click="close">境内に戻る</button>
    </div>

    <p class="offering-free-note">参拝は無料でお楽しみいただけます。</p>
  </div>
</template>

<style scoped>
.offering-experience {
  color: var(--shrine-ink, #303730);
  text-align: center;
}
.offering-shrine-name {
  margin: 0;
  color: var(--shrine-red, #8b4436);
  font-size: 10px;
  letter-spacing: .12em;
}
.offering-experience h2 { margin: 7px 0 0; }
.offering-intro {
  margin: 12px 0 0;
  color: var(--shrine-secondary, #666b61);
  font-size: 12px;
  line-height: 1.95;
  letter-spacing: .025em;
}
.offering-scene {
  --offering-drop: 90px;
  position: relative;
  height: 230px;
  max-width: 300px;
  margin: 19px auto 0;
  perspective: 500px;
}
.offering-box {
  position: absolute;
  width: 260px;
  max-width: 100%;
  height: auto;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
}
.offering-box-label {
  fill: #5c4933;
  font-family: var(--shrine-mincho, serif);
  font-size: 16px;
  text-anchor: middle;
}
.offering-coin-button {
  position: absolute;
  z-index: 1;
  top: 0;
  left: 50%;
  display: flex;
  align-items: center;
  flex-direction: column;
  width: 152px;
  min-height: 124px;
  padding: 0 8px 5px;
  border: 0;
  background: transparent;
  color: #5c4933;
  cursor: pointer;
  transform: translateX(-50%);
  -webkit-tap-highlight-color: transparent;
}
.offering-coin {
  display: block;
  width: 94px;
  height: 94px;
  transform: rotate(-7deg);
  transition: transform 180ms ease;
}
.offering-coin-button:hover:not(:disabled) .offering-coin { transform: translateY(-3px) rotate(-2deg); }
.offering-coin-button:not(:disabled):active { transform: translate(-50%, 1px); }
.offering-coin-button:focus-visible {
  outline: 2px solid var(--shrine-red, #8b4436);
  outline-offset: 3px;
  border-radius: 2px;
}
.offering-coin-button:disabled { cursor: default; opacity: 1; }
.offering-coin-letter {
  fill: #826b36;
  font-family: var(--shrine-mincho, serif);
  font-size: 18px;
  letter-spacing: .12em;
  text-anchor: middle;
}
.offering-coin-caption {
  margin-top: 8px;
  padding: 2px 5px;
  background: var(--shrine-paper, #f4f1e9);
  font-family: var(--shrine-mincho, serif);
  font-size: 12px;
  letter-spacing: .05em;
}
[data-phase="tossing"] .offering-coin { animation: offering-coin-drop 680ms both; }
[data-phase="tossing"] .offering-coin-caption,
[data-phase="settled"] .offering-coin-button { visibility: hidden; }
.offering-status {
  min-height: 22px;
  margin: 9px 0 0;
  color: var(--shrine-secondary, #666b61);
  font-size: 11px;
  line-height: 1.9;
}
.offering-actions {
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 116px;
  gap: 0;
  margin-top: 17px;
}
.offering-support-link {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  width: min(100%, 254px);
  text-decoration: none;
}
.offering-support-link:focus-visible {
  outline: 2px solid var(--shrine-red, #8b4436);
  outline-offset: 3px;
}
.offering-external-note {
  margin-top: 8px;
  color: var(--shrine-secondary, #666b61);
  font-size: 10px;
}
.offering-return {
  min-height: 40px;
  margin-top: 6px;
  padding: 7px 12px;
  border: 0;
  background: transparent;
  color: var(--shrine-secondary, #666b61);
  font-family: var(--shrine-mincho, serif);
  font-size: 12px;
  letter-spacing: .05em;
  cursor: pointer;
}
.offering-return:hover { color: var(--shrine-ink, #303730); text-decoration: underline; text-underline-offset: 4px; }
.offering-notice {
  margin: 10px 0 0;
  color: var(--shrine-secondary, #666b61);
  font-size: 11px;
  line-height: 1.9;
  text-wrap: pretty;
}
.offering-free-note {
  margin: 12px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--shrine-line, #cecabe);
  color: var(--shrine-secondary, #666b61);
  font-size: 10px;
  line-height: 1.8;
}
@keyframes offering-coin-drop {
  0% { opacity: 1; transform: translateY(0) rotateX(0) rotate(-7deg); }
  22% { opacity: 1; transform: translateY(-10px) rotateX(12deg) rotate(10deg); }
  66% { opacity: 1; transform: translateY(calc(var(--offering-drop) * .78)) rotateX(65deg) rotate(-20deg) scale(.68); }
  100% { opacity: 0; transform: translateY(var(--offering-drop)) rotateX(88deg) rotate(-30deg) scale(.48); }
}
@media (max-width: 600px) {
  .offering-scene { margin-top: 15px; }
  .offering-desktop-break { display: none; }
}
@media (max-height: 740px) {
  .offering-scene { --offering-drop: 64px; height: 190px; margin-top: 10px; }
  .offering-coin { width: 82px; height: 82px; }
  .offering-coin-button { min-height: 110px; }
  .offering-box { width: 235px; }
  .offering-intro { margin-top: 7px; }
  .offering-notice { margin-top: 8px; }
  .offering-actions { margin-top: 10px; }
}
.offering-reduced .offering-coin { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .offering-coin { transition: none; animation: none !important; }
}
</style>
