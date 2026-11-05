<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId } from "vue";
import { OMIKUJI_DRAW_DURATION, OmikujiDraw, type OmikujiDrawState } from "../game/OmikujiDraw";
import { formatFortuneNumber } from "../game/fortunes";
import OmikujiSlip from "./OmikujiSlip.vue";

const emit = defineEmits<{ drawn: []; close: [] }>();
const experience = ref<HTMLElement>();
const drawButton = ref<HTMLButtonElement>();
const openButton = ref<HTMLButtonElement>();
const state = shallowRef<OmikujiDrawState>({ phase: "ready", fortune: null });
const statusId = `omikuji-status-${useId()}`;
const number = computed(() => state.value.fortune ? formatFortuneNumber(state.value.fortune.number) : "");
let disposed = false;

const controller = new OmikujiDraw((nextState) => {
  state.value = nextState;
  void focusPhase(nextState.phase);
}, () => emit("drawn"));

async function focusPhase(phase: OmikujiDrawState["phase"]) {
  await nextTick();
  if (disposed || state.value.phase !== phase) return;
  if (phase === "ready" && drawButton.value?.isConnected) drawButton.value.focus({ preventScroll: true });
  if (phase === "drawn" && openButton.value?.isConnected) openButton.value.focus({ preventScroll: true });
  if (phase === "reading") {
    const paper = experience.value?.querySelector<HTMLElement>(".fortune-slip-content");
    if (paper?.isConnected) paper.focus({ preventScroll: true });
  }
}

function draw() {
  controller.draw(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

onMounted(() => void focusPhase("ready"));
function cancel() {
  disposed = true;
  controller.dispose();
}

defineExpose({ cancel });
onBeforeUnmount(cancel);
</script>

<template>
  <div ref="experience" class="omikuji-experience">
    <OmikujiSlip
      v-if="state.phase === 'reading' && state.fortune"
      class="omikuji-opened-slip"
      :fortune="state.fortune"
      @close="emit('close')"
    />
    <div
      v-else
      class="omikuji-draw"
      :data-phase="state.phase"
      :style="{ '--omikuji-draw-duration': `${OMIKUJI_DRAW_DURATION}ms` }"
    >
      <header class="omikuji-draw-heading">
        <p class="omikuji-shrine-name">こもれび神社</p>
        <h2 id="dialog-title">おみくじ</h2>
        <p class="omikuji-draw-intro">心を静めて、ひとつお引きください。</p>
      </header>

      <div class="omikuji-vessel-area" aria-hidden="true">
        <svg class="omikuji-vessel-art" viewBox="0 0 260 320" fill="none">
          <ellipse cx="130" cy="285" rx="66" ry="8" fill="#685541" opacity=".09" />
          <g class="omikuji-vessel">
            <g class="omikuji-stick">
              <path d="M123 25Q130 19 137 25V181H123Z" fill="#d9bf8c" stroke="#927044" />
              <path d="M127 28V176M133 27V177" stroke="#f5e4bb" stroke-opacity=".5" />
              <text v-if="state.phase === 'drawn'" x="130" y="43" class="omikuji-stick-number">第{{ number }}番</text>
            </g>
            <path d="M60 145L100 165V275L60 252Z" fill="#8d5c34" stroke="#654426" stroke-linejoin="round" />
            <path d="M100 165H160V275H100Z" fill="#af7b47" stroke="#76522d" />
            <path d="M160 165L200 145V252L160 275Z" fill="#69472c" stroke="#513922" stroke-linejoin="round" />
            <g stroke-linecap="round">
              <path d="M67 156C74 182 68 207 73 249M77 159C72 191 83 220 78 257M89 168C83 193 94 225 89 264" stroke="#5b3d27" stroke-opacity=".25" />
              <path d="M64 169C71 189 64 215 69 242M83 174C91 201 79 222 86 252" stroke="#d2a26b" stroke-opacity=".3" />
              <path d="M106 173C113 202 103 229 110 268M119 174C115 204 124 234 119 269M144 172C137 202 149 235 141 270M153 175C148 203 157 237 151 265" stroke="#704a27" stroke-opacity=".2" />
              <path d="M112 179C118 204 109 228 115 261M136 174C130 211 141 234 134 271" stroke="#e3bb80" stroke-opacity=".35" />
              <path d="M167 174C173 201 163 235 169 263M181 164C175 190 187 221 178 257M192 157C184 187 195 219 188 246" stroke="#382a1e" stroke-opacity=".3" />
              <path d="M172 170C178 198 169 226 175 252M188 164C182 189 192 213 185 244" stroke="#b48a57" stroke-opacity=".23" />
            </g>
            <path d="M60 145L100 125H160L200 145L160 165H100Z" fill="#c39961" stroke="#785733" stroke-linejoin="round" />
            <path d="M68 145L102 129H158L191 145L158 161H102Z" stroke="#e3be85" stroke-opacity=".55" />
            <path d="M83 145L109 133M99 153L133 132M119 158L159 135M142 158L174 143" stroke="#8d663e" stroke-opacity=".22" />
            <rect x="115" y="141" width="30" height="5" rx="2.5" fill="#3f2e20" />
            <path d="M61 158L100 178H160L199 158M61 244L100 266H160L199 244" stroke="#573d27" stroke-width="3" stroke-opacity=".7" />
            <path d="M61 160L100 180H160L199 160M61 246L100 268H160L199 246" stroke="#d4ab72" stroke-opacity=".4" />
            <rect x="110" y="186" width="40" height="69" fill="#eee3cc" stroke="#7c3f32" stroke-width=".9" />
            <rect x="113" y="189" width="34" height="63" stroke="#a46551" stroke-opacity=".4" stroke-width=".6" />
            <text x="130" y="205" class="omikuji-vessel-label"><tspan x="130">御</tspan><tspan x="130" dy="19">神</tspan><tspan x="130" dy="19">籤</tspan></text>
          </g>
        </svg>
      </div>

      <div :id="statusId" class="omikuji-draw-status" role="status" aria-live="polite" aria-atomic="true">
        <template v-if="state.phase === 'drawn'">
          <p class="omikuji-drawn-number">第{{ number }}番</p>
          <p>御神籤をひらいて、お読みください。</p>
        </template>
        <template v-else-if="state.phase === 'drawing'">
          <p class="omikuji-drawing-label">筒を振っています</p>
          <p>しばらくお待ちください。</p>
        </template>
        <p v-else>お引きいただくと、御神籤の番号が現れます。</p>
      </div>

      <div class="omikuji-draw-actions">
        <button
          v-if="state.phase === 'drawn'"
          ref="openButton"
          class="primary-button"
          :aria-describedby="statusId"
          @click="controller.open()"
        >御神籤をひらく</button>
        <button
          v-else
          ref="drawButton"
          class="primary-button"
          data-omikuji-initial-focus
          :disabled="state.phase === 'drawing'"
          :aria-describedby="statusId"
          @click="draw"
        >{{ state.phase === 'drawing' ? 'おみくじを引いています' : 'おみくじを引く' }}</button>
        <button class="omikuji-return" @click="emit('close')">境内に戻る</button>
      </div>
    </div>
  </div>
</template>
