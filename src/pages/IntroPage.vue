<template>
  <div class="static-page story-page">

    <article class="content-card">

      <header class="story-header">
        <p class="eyebrow">CK PARTY NIGHT</p>

        <h1>關於建中舞會</h1>

        <p class="intro">
            Cosmos, the universe, the infinite space, and the endless possibilities. <br>
          <br>
        </p>
      </header>

      <!-- Loading -->
      <div
        v-if="loading"
        class="story-state"
      >
        <span class="loading-dot"></span>
        <span>載入故事中...</span>
      </div>

      <div
        v-else-if="stories.length === 0"
        class="story-state empty"
      >
        <p class="state-title">Coming Soon</p>
        <p>敬請期待 CK Party Night 的下一個篇章</p>
      </div>

      <div
        v-else
        class="stories"
      >

        <section
          v-for="(story, index) in stories"
          :key="story.id"
          class="story"
        >

          <div class="story-heading">

            <span class="story-number">
              {{ String(index + 1).padStart(2, '0') }}
            </span>

            <div class="story-heading-content">
              <p class="story-label">
                CHAPTER {{ String(index + 1).padStart(2, '0') }}
              </p>

              <h2>{{ story.title }}</h2>

              <p
                v-if="story.subtitle"
                class="story-subtitle"
              >
                {{ story.subtitle }}
              </p>

              <time
                v-if="story.publishAt"
                class="story-date"
              >
                {{ formatDate(story.publishAt) }}
              </time>
            </div>

          </div>

          <div class="story-content">

            <p
              v-for="(paragraph, paragraphIndex) in getParagraphs(story.content)"
              :key="paragraphIndex"
            >
              {{ paragraph }}
            </p>

          </div>

        </section>

      </div>

      <!-- Actions -->
      <div class="actions">

        <router-link
          to="/"
          class="ghost-button"
        >
          回到首頁
        </router-link>

      </div>

    </article>

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  collection,
  getDocs
} from 'firebase/firestore'

import { db } from 'src/boot/firebase'

const stories = ref([])
const loading = ref(true)

function getParagraphs(content) {
  if (!content) return []

  return content
    .split(/\r?\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
}

function formatDate(value) {
  if (!value) return ''

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date)
}

async function loadStories() {
  loading.value = true

  try {
    const snapshot = await getDocs(
      collection(db, 'partyStories')
    )

    const now = new Date()

    stories.value = snapshot.docs
      .map(document => ({
        id: document.id,
        ...document.data()
      }))
      .filter(story => {
        if (story.enabled === false) {
          return false
        }

        if (!story.publishAt) {
          return false
        }

        const publishAt = new Date(story.publishAt)

        return (
          !Number.isNaN(publishAt.getTime()) &&
          publishAt <= now
        )
      })
      .sort((a, b) => {
        return (
          (Number(a.order) || 0) -
          (Number(b.order) || 0)
        )
      })

  } catch (error) {
    console.error('Load party stories error:', error)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadStories()
})
</script>

<style scoped lang="scss">
@import 'src/css/intropage.scss';
</style>