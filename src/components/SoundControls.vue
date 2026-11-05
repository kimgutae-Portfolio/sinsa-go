<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import type { ShrineAudio, SoundSnapshot } from "../audio/ShrineAudio";

const props = defineProps<{ dismissed?: boolean; audio: ShrineAudio; sound: SoundSnapshot }>();
const open = ref(false);
watch(() => props.dismissed, value => { if (value) open.value = false; });
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const playing = computed(() => props.sound.state === "playing");
const label = computed(() => playing.value ? "境内の音" :
  props.sound.state === "loading" ? "音の準備中" :
  props.sound.remembered ? "音を再開" : "音を聴く");
function toggle() {
  void props.audio.setEnabled(!props.sound.enabled || ["blocked", "error"].includes(props.sound.state));
}
function activate() {
  open.value = !open.value;
  if (open.value && !playing.value && props.sound.state !== "loading") void props.audio.setEnabled(true);
}
function close() { open.value = false; trigger.value?.focus(); }
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false;
}
onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
});
</script>

<template>
  <div ref="root" class="sound-controls" @keydown.esc.stop.prevent="close">
    <button ref="trigger" class="sound-trigger glass" :class="{ playing }"
      :aria-expanded="open" aria-controls="shrine-sound-panel" @click="activate">
      <Icon :name="playing ? 'sound' : 'muted'" :size="16" />
      <span>{{ label }}</span>
      <span v-if="playing" class="sound-meter" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>
    <Transition name="fade">
      <section v-if="open" id="shrine-sound-panel" class="sound-panel glass" aria-label="境内の音の設定">
        <div class="sound-heading"><span>音の設定</span>
          <button aria-label="音の設定を閉じる" @click="close"><Icon name="close" :size="17" /></button>
        </div>
        <h2>境内の音</h2>
        <p>木々の風、小鳥、笛と鈴の音。</p>
        <button class="sound-switch" :aria-pressed="playing" @click="toggle">
          <Icon :name="playing ? 'muted' : 'sound'" :size="18" />
          {{ sound.enabled && !['blocked', 'error'].includes(sound.state) ? '音を休める' : '音を聴く' }}
        </button>
        <label class="sound-volume" for="shrine-volume"><span>音量</span><output for="shrine-volume">{{ Math.round(sound.volume * 100) }}%</output></label>
        <input id="shrine-volume" type="range" min="0" max="100" step="1" :value="Math.round(sound.volume * 100)"
          :aria-valuetext="`${Math.round(sound.volume * 100)}パーセント`"
          @input="audio.setVolume(Number(($event.target as HTMLInputElement).value) / 100)" />
        <p v-if="sound.state === 'error'" class="sound-status" role="status">音を読み込めませんでした。「音を聴く」で、もう一度お試しください。</p>
        <p v-else-if="sound.state === 'blocked'" class="sound-status" role="status">「音を聴く」を押すと、再生を再開します。</p>
        <p v-else-if="sound.state === 'loading'" class="sound-status" role="status">境内の音を準備しています…</p>
        <small>音量は保存されます。別のタブでは一時停止します。</small>
      </section>
    </Transition>
  </div>
</template>

