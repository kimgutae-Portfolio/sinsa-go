<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
const props = defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ move: [x: number, y: number] }>();
const surface = ref<HTMLElement>();
const offset = ref({ x: 0, y: 0 });
const active = ref(false);
let pointerId: number | null = null;
function move(event: PointerEvent) {
  if (props.disabled || pointerId !== event.pointerId || !surface.value) return;
  const rect = surface.value.getBoundingClientRect();
  let x = event.clientX - rect.left - rect.width / 2;
  let y = event.clientY - rect.top - rect.height / 2;
  const distance = Math.hypot(x, y);
  if (distance > 36) {
    x *= 36 / distance;
    y *= 36 / distance;
  }
  offset.value = { x, y };
  emit("move", x / 36, -y / 36);
}
function start(event: PointerEvent) {
  if (props.disabled || pointerId !== null) return;
  pointerId = event.pointerId;
  active.value = true;
  surface.value?.setPointerCapture(event.pointerId);
  move(event);
}
function stop(event?: PointerEvent) {
  if (event && pointerId !== event.pointerId) return;
  if (pointerId !== null && surface.value?.hasPointerCapture(pointerId))
    surface.value.releasePointerCapture(pointerId);
  pointerId = null;
  offset.value = { x: 0, y: 0 };
  active.value = false;
  emit("move", 0, 0);
}
watch(
  () => props.disabled,
  (value) => {
    if (value) stop();
  },
);
onBeforeUnmount(() => stop());
</script>
<template>
  <div
    ref="surface"
    class="joystick"
    :class="{ active, disabled }"
    aria-label="移動用タッチジョイスティック"
    @pointerdown.prevent="start"
    @pointermove.prevent="move"
    @pointerup="stop"
    @pointercancel="stop"
    @lostpointercapture="stop"
  >
    <span class="joystick-cross">＋</span>
    <span
      class="joystick-knob"
      :style="{ transform: `translate(${offset.x}px, ${offset.y}px)` }"
    ></span>
  </div>
</template>
