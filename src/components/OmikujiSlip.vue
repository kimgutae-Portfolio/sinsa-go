<script setup lang="ts">
import { FORTUNE_CATEGORIES, formatFortuneNumber, type Fortune } from "../game/fortunes";
import Icon from "./Icon.vue";

defineProps<{ fortune: Fortune }>();
defineEmits<{ close: [] }>();
</script>

<template>
  <div class="fortune-slip-content" role="document" tabindex="0" aria-label="御神籤の本文">
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
    <button class="primary-button" @click="$emit('close')">
      境内に戻る<Icon name="arrow" :size="17" />
    </button>
  </div>
</template>
