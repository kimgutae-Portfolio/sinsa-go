<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { FORTUNE_CATEGORIES, formatFortuneNumber, type Fortune } from "../game/fortunes";
import Icon from "./Icon.vue";

defineProps<{ fortune: Fortune }>();
defineEmits<{ close: [] }>();

const paper = ref<HTMLElement>();
const text = ref<HTMLElement>();
const progress = ref(0);
const atEnd = computed(() => progress.value >= 0.999);
let resizeObserver: ResizeObserver | undefined;

function updateReadingPosition() {
  if (!paper.value) return;
  const distance = paper.value.scrollHeight - paper.value.clientHeight;
  progress.value = distance > 0 ? Math.min(1, Math.max(0, paper.value.scrollTop / distance)) : 1;
}

function movePaper() {
  if (!paper.value) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  paper.value.scrollTo({
    top: atEnd.value ? 0 : paper.value.scrollTop + paper.value.clientHeight * 0.78,
    behavior: reducedMotion ? "instant" : "smooth",
  });
}

onMounted(() => {
  resizeObserver = new ResizeObserver(updateReadingPosition);
  if (paper.value) resizeObserver.observe(paper.value);
  if (text.value) resizeObserver.observe(text.value);
  updateReadingPosition();
});
onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <div class="fortune-reader" :class="{ 'has-read': progress > 0.01, 'has-more': !atEnd }">
    <div
      ref="paper"
      class="fortune-slip-content"
      role="document"
      tabindex="0"
      aria-label="御神籤の本文"
      @scroll.passive="updateReadingPosition"
    >
      <div ref="text" class="fortune-slip-text">
        <header class="fortune-heading">
          <div class="eyebrow fortune-caption"><span>こもれび神社</span><span>御神籤</span></div>
          <p class="fortune-number">第{{ formatFortuneNumber(fortune.number) }}番</p>
          <h2 id="dialog-title" class="fortune-title">{{ fortune.title }}</h2>
          <span class="fortune-reading">{{ fortune.reading }}</span>
        </header>
        <div class="fortune-rule" aria-hidden="true"><span></span></div>
        <section class="fortune-teaching" aria-labelledby="fortune-teaching-title">
          <p class="fortune-section-label">運勢のことば</p>
          <h3 id="fortune-teaching-title">{{ fortune.message }}</h3>
          <p class="fortune-description">{{ fortune.detail }}</p>
        </section>
        <dl class="fortune-details" aria-label="それぞれの運勢">
          <div v-for="category in FORTUNE_CATEGORIES" :key="category.key">
            <dt>{{ category.label }}<span>{{ category.reading }}</span></dt>
            <dd>{{ fortune.readings[category.key] }}</dd>
          </div>
        </dl>
        <p class="fortune-footnote">結果にとらわれず、今の暮らしに重ねてお読みください。</p>
      </div>
    </div>
    <div class="fortune-reading-progress" aria-hidden="true">
      <span :style="{ transform: `scaleX(${progress})` }"></span>
    </div>
    <footer class="fortune-reader-footer">
      <button
        class="fortune-send-paper"
        :aria-label="atEnd ? '御神籤のはじめに戻る' : '続きを下へ読む'"
        @click="movePaper"
      >
        <span>{{ atEnd ? 'はじめに戻る' : '続きを読む' }}</span>
        <Icon name="arrow" :size="14" :class="{ 'points-up': atEnd }" />
      </button>
      <button class="fortune-return" @click="$emit('close')">
        境内に戻る<Icon name="arrow" :size="17" />
      </button>
    </footer>
  </div>
</template>
