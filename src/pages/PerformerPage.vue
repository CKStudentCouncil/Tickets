<template>
  <div class="static-page">
    <main class="content-card">

      <!-- Page heading -->
      <header class="page-heading">
        <p class="eyebrow">CK PARTY NIGHT</p>

        <h1>社團與藝人</h1>

        <p class="page-intro">
          來自不同舞台的聲音，在同一個夜晚相遇
        </p>
      </header>

      <!-- Loading -->
      <div v-if="loading" class="state">
        <span>載入中...</span>
      </div>

      <!-- Content -->
      <template v-else>

        <!-- =========================
             CLUBS
             ========================= -->
        <section
          v-if="clubs.length > 0"
          class="lineup-section"
        >
          <div class="section-heading">
            <div>
              <p class="section-eyebrow">CLUBS</p>
              <h2>社團</h2>
            </div>

            <span class="section-count">
              {{ String(clubs.length).padStart(2, '0') }}
            </span>
          </div>

          <div class="lineup-list">
            <article
              v-for="item in clubs"
              :key="item.id"
              class="lineup-item"
            >
              <div
                v-if="item.imageUrl"
                class="item-image"
              >
                <img
                  :src="item.imageUrl"
                  :alt="item.title || item.name"
                  loading="lazy"
                >
              </div>

              <div class="item-body">

                <div class="item-meta">
                  <span>CLUB</span>

                  <time
                    v-if="item.publishAt"
                    :datetime="item.publishAt"
                  >
                    {{ formatDate(item.publishAt) }}
                  </time>
                </div>

                <h3>
                  {{ item.title || item.name }}
                </h3>

                <p
                  v-if="
                    item.title &&
                    item.name &&
                    item.title !== item.name
                  "
                  class="item-name"
                >
                  {{ item.name }}
                </p>

                <div class="item-content">
                  <p
                    v-for="(paragraph, index) in getParagraphs(item.content)"
                    :key="index"
                  >
                    {{ paragraph }}
                  </p>
                </div>

              </div>
            </article>
          </div>
        </section>


        <!-- =========================
             ARTISTS
             ========================= -->
        <section
          v-if="artists.length > 0"
          class="lineup-section"
        >
          <div class="section-heading">
            <div>
              <p class="section-eyebrow">ARTISTS</p>
              <h2>藝人</h2>
            </div>

            <span class="section-count">
              {{ String(artists.length).padStart(2, '0') }}
            </span>
          </div>

          <div class="lineup-list">
            <article
              v-for="item in artists"
              :key="item.id"
              class="lineup-item"
            >
              <div
                v-if="item.imageUrl"
                class="item-image"
              >
                <img
                  :src="item.imageUrl"
                  :alt="item.title || item.name"
                  loading="lazy"
                >
              </div>

              <div class="item-body">

                <div class="item-meta">
                  <span>ARTIST</span>

                  <time
                    v-if="item.publishAt"
                    :datetime="item.publishAt"
                  >
                    {{ formatDate(item.publishAt) }}
                  </time>
                </div>

                <h3>
                  {{ item.title || item.name }}
                </h3>

                <p
                  v-if="
                    item.title &&
                    item.name &&
                    item.title !== item.name
                  "
                  class="item-name"
                >
                  {{ item.name }}
                </p>

                <div class="item-content">
                  <p
                    v-for="(paragraph, index) in getParagraphs(item.content)"
                    :key="index"
                  >
                    {{ paragraph }}
                  </p>
                </div>

              </div>
            </article>
          </div>
        </section>


        <!-- Empty -->
        <div
          v-if="clubs.length === 0 && artists.length === 0"
          class="empty-state"
        >
          <p class="section-eyebrow">COMING SOON</p>

          <h2>演出陣容即將公布</h2>

          <p>
            更多社團與藝人資訊將陸續公開，敬請期待
          </p>
        </div>

      </template>


      <!-- Actions -->
      <div class="actions">
        <router-link
          to="/"
          class="primary-button"
        >
          回到首頁
        </router-link>
      </div>

    </main>
  </div>
</template>

<script setup>
import { collection, getDocs } from 'firebase/firestore'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { db } from 'src/boot/firebase'
import { formatLongDate as formatDate, isPublished, parseDate } from 'src/utils/datetime'
import { splitParagraphs as getParagraphs } from 'src/utils/text'

const items = ref([])
const loading = ref(true)
const now = ref(new Date())

let refreshTimer = null

// re-evaluated every 30s so scheduled items appear without a reload
const publishedItems = computed(() =>
  items.value.filter((item) => isPublished(item.publishAt, now.value))
)

const clubs = computed(() =>
  publishedItems.value.filter((item) => item.type === 'club').sort(sortByPublishDate)
)

const artists = computed(() =>
  publishedItems.value.filter((item) => item.type === 'artist').sort(sortByPublishDate)
)

onMounted(async () => {
  await loadItems()
  refreshTimer = setInterval(() => {
    now.value = new Date()
  }, 30000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

async function loadItems() {
  loading.value = true

  try {
    const snapshot = await getDocs(collection(db, 'partyLineup'))
    items.value = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }))
  } catch (error) {
    console.error('Failed to load party lineup:', error)
    items.value = []
  } finally {
    loading.value = false
  }
}

function sortByPublishDate(a, b) {
  return (parseDate(a.publishAt)?.getTime() || 0) - (parseDate(b.publishAt)?.getTime() || 0)
}
</script>

<style scoped>
@import 'src/css/performerpage.scss';
</style>