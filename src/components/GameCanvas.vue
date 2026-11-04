<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Game } from "../game/Game";
import type {
  GameSnapshot,
  InteractionId,
  SceneLabel,
  VisitorLabel,
} from "../game/types";
import type { Presence } from "../shared/multiplayer";
import type { LanternState } from "../shared/lanterns";
import type { VisitorSummary } from "../shared/visitorStats";
const props = defineProps<{ paused: boolean }>();
const emit = defineEmits<{
  profile: [profile: VisitorSummary];
  purified: [];
  lanterns: [state: LanternState];
  ready: [];
  update: [snapshot: GameSnapshot];
  labels: [labels: SceneLabel[]];
  fortune: [];
  ema: [];
  prayed: [];
  notice: [message: string];
  presence: [presence: Presence];
  visitors: [visitors: VisitorLabel[]];
}>();
const container = ref<HTMLDivElement>();
const error = ref("");
const reload = () => window.location.reload();
let game: Game | undefined;
let disposed = false;
onMounted(async () => {
  if (!container.value) return;
  try {
    game = new Game(container.value, {
      onUpdate: (snapshot) => emit("update", snapshot),
      onLabels: (labels) => emit("labels", labels),
      onFortune: () => emit("fortune"),
      onEma: () => emit("ema"),
      onPrayed: () => emit("prayed"),
      onNotice: (message) => emit("notice", message),
      onPresence: (presence) => emit("presence", presence),
      onProfile: (profile) => emit("profile", profile),
      onVisitors: (visitors) => emit("visitors", visitors),
      onPurified: () => emit("purified"),
      onLanterns: (state) => emit("lanterns", state),
    });
    game.setPaused(props.paused);
    await game.init();
    if (!disposed) emit("ready");
  } catch (cause) {
    console.error(cause);
    game?.dispose();
    if (!disposed)
      error.value =
        "3Dの境内をひらけませんでした。WebGL対応のブラウザーでハードウェアアクセラレーションを有効にして、もう一度お試しください。";
  }
});
watch(
  () => props.paused,
  (value) => game?.setPaused(value),
);
onBeforeUnmount(() => {
  disposed = true;
  game?.dispose();
  game = undefined;
});
defineExpose({
  interact: () => game?.interact(),
  touch: (x: number, y: number) => game?.setTouch(x, y),
  zoom: (delta: number) => game?.zoom(delta),
  reset: () => game?.reset(),
  visit: (id: InteractionId) => game?.visit(id),
  joinRoom: (room: string) => game?.joinRoom(room),
  hangLantern: (
    productId: string,
    wish: string,
    signature: string,
    slot: number | null,
  ) => game?.hangLantern(productId, wish, signature, slot),
  removeLantern: (id: string) => game?.removeLantern(id),
  reportLantern: (id: string) => game?.reportLantern(id),
});
</script>
<template>
  <div ref="container" class="game-canvas">
    <div v-if="error" class="canvas-error" role="alert">
      <span>境内への道で、少し立ち止まっています。</span>
      <p>{{ error }}</p>
      <button class="primary-button" @click="reload">もう一度ひらく</button>
    </div>
  </div>
</template>
