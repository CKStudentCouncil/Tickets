<template>
  <div
    v-if="auth.loading || checkingAdmin"
    class="state-screen"
  >
    <p>{{ auth.loading ? '載入中...' : '驗證權限中...' }}</p>
  </div>

  <div
    v-else-if="!canManageOrders"
    class="state-screen"
  >
    <h2>權限不足</h2>

    <button
      type="button"
      class="btn"
      @click="$router.push('/')"
    >
      回到首頁
    </button>
  </div>

  <div
    v-else
    class="admin-page"
  >

    <!-- Page heading -->
    <div class="page-heading">
      <p class="eyebrow">後台管理</p>

      <div class="page-heading-row">
        <div>
          <h1>舞會介紹</h1>

          <p class="page-description">
            管理前台「舞會介紹」頁面所顯示的介紹內容
          </p>
        </div>

        <button
          type="button"
          class="btn"
          @click="openCreateStory"
        >
          新增內容
        </button>
      </div>
    </div>

    <!-- Story list -->
    <section class="panel story-panel">

      <div class="notify-header">
        <div>
          <h2>介紹列表</h2>
        </div>
      </div>

      <p
        v-if="loading"
        class="empty"
      >
        介紹資料載入中...
      </p>

      <p
        v-else-if="stories.length === 0"
        class="empty"
      >
        目前尚未建立介紹
      </p>

      <div
        v-else
        class="story-list"
      >

        <article
          v-for="(story, index) in stories"
          :key="story.id"
          class="story-card"
        >

          <div class="story-card-number">
            {{ String(index + 1).padStart(2, '0') }}
          </div>

          <div class="story-card-main">

            <div class="story-card-heading">

              <div>
                <p class="story-label">
                  CHAPTER {{ String(index + 1).padStart(2, '0') }}
                </p>

                <h3>
                  {{ story.title || '未命名故事' }}
                </h3>

                <p
                  v-if="story.subtitle"
                  class="story-subtitle"
                >
                  {{ story.subtitle }}
                </p>
              </div>

              <span
                class="story-status"
                :class="getStoryStatus(story).class"
              >
                <span class="status-dot"></span>
                {{ getStoryStatus(story).text }}
              </span>

            </div>

            <p class="story-preview-text">
              {{ getPreviewText(story.content) }}
            </p>

            <div class="story-meta">

              <span>
                公開時間
                <strong>
                  {{ formatDateTime(story.publishAt) }}
                </strong>
              </span>

              <span>
                排序
                <strong>
                  {{ story.order ?? 0 }}
                </strong>
              </span>

              <span>
                {{ story.enabled === false ? '已停用' : '已啟用' }}
              </span>

            </div>

          </div>

          <div class="story-card-actions">

            <button
              type="button"
              class="btn-outline"
              @click="openEditStory(story)"
            >
              編輯
            </button>

            <button
              type="button"
              class="btn-outline danger"
              @click="deleteStory(story)"
            >
              刪除
            </button>

          </div>

        </article>

      </div>

    </section>

    <!-- Editor -->
    <section
      v-if="editing"
      class="panel editor-panel"
    >

      <div class="notify-header">

        <div>
          <p class="editor-label">
            {{ editingExisting ? '編輯故事' : '新增故事' }}
          </p>

          <h2>
            {{ storyForm.title || '故事內容' }}
          </h2>

          <p class="panel-copy">
            設定故事內容及自動公開時間。
          </p>
        </div>

        <div class="editor-actions">

          <button
            type="button"
            class="btn-outline"
            :disabled="saving"
            @click="cancelEdit"
          >
            取消
          </button>

          <button
            type="button"
            class="btn"
            :disabled="saving"
            @click="saveStory"
          >
            {{ saving ? '儲存中...' : '儲存故事' }}
          </button>

        </div>

      </div>

      <div class="story-form">

        <!-- Title -->
        <div class="field">
          <span>故事標題</span>

          <input
            v-model="storyForm.title"
            type="text"
            placeholder="例如：舞會的開始"
          >
        </div>

        <!-- Subtitle -->
        <div class="field">
          <span>副標題</span>

          <input
            v-model="storyForm.subtitle"
            type="text"
            placeholder="例如：Before the night begins"
          >
        </div>

        <!-- Content -->
        <div class="field">
          <span>故事內容</span>

          <textarea
            v-model="storyForm.content"
            rows="18"
            placeholder="請輸入故事內容...

每一個換行都會在前台呈現為新的段落。"
          ></textarea>

          <small class="field-hint">
            建議使用換行區分不同段落。
          </small>
        </div>

        <!-- Time + order -->
        <div class="editor-grid">

          <div class="field ticket-time-field">
            <span>自動公開時間</span>

            <div class="time-range">

              <div class="time-group">

                <div class="time-label">
                  公開日期與時間
                </div>

                <div class="time-inputs">

                  <input
                    type="date"
                    :value="getPart(storyForm.publishAt, 'date')"
                    @input="
                      setPart(
                        storyForm,
                        'publishAt',
                        'date',
                        $event.target.value,
                        '00:00'
                      )
                    "
                  >

                  <input
                    type="time"
                    :value="getPart(storyForm.publishAt, 'time')"
                    @input="
                      setPart(
                        storyForm,
                        'publishAt',
                        'time',
                        $event.target.value,
                        '00:00'
                      )
                    "
                  >

                </div>

                <div class="time-presets">

                  <button
                    type="button"
                    class="time-chip"
                    @click="setPublishNow"
                  >
                    立即公開
                  </button>

                  <button
                    type="button"
                    class="time-chip"
                    @click="setPublishAfter(1)"
                  >
                    +1 天
                  </button>

                  <button
                    type="button"
                    class="time-chip"
                    @click="setPublishAfter(7)"
                  >
                    +7 天
                  </button>

                  <button
                    type="button"
                    class="time-chip"
                    @click="setPublishAfter(30)"
                  >
                    +30 天
                  </button>

                </div>

                <p
                  class="time-summary"
                  :class="publishSummary.level"
                >
                  {{ publishSummary.text }}
                </p>

              </div>

            </div>
          </div>

          <div class="field">
            <span>排序</span>

            <input
              v-model.number="storyForm.order"
              type="number"
              min="0"
              step="1"
              placeholder="例如：1"
            >

            <small class="field-hint">
              數字越小越前面。
            </small>
          </div>

        </div>

        <!-- Enabled -->
        <label class="enabled-control">

          <input
            v-model="storyForm.enabled"
            type="checkbox"
          >

          <span>
            <strong>啟用此故事</strong>

            <small>
              停用後，即使已經到公開時間，前台也不會顯示。
            </small>
          </span>

        </label>

        <!-- Preview -->
        <div class="preview-section">

          <div class="preview-header">
            <div>
              <p class="editor-label">
                PREVIEW
              </p>

              <h3>前台內容預覽</h3>
            </div>
          </div>

          <div class="story-preview">

            <div class="preview-number">
              {{ String(storyForm.order || 1).padStart(2, '0') }}
            </div>

            <div class="preview-content">

              <p class="story-label">
                CHAPTER
                {{ String(storyForm.order || 1).padStart(2, '0') }}
              </p>

              <h2>
                {{ storyForm.title || '故事標題' }}
              </h2>

              <p
                v-if="storyForm.subtitle"
                class="preview-subtitle"
              >
                {{ storyForm.subtitle }}
              </p>

              <div class="preview-text">

                <p
                  v-for="(paragraph, index) in previewParagraphs"
                  :key="index"
                >
                  {{ paragraph }}
                </p>

              </div>

            </div>

          </div>

        </div>

      </div>

    </section>

  </div>
</template>

<script setup>
import {
  ref,
  computed,
  onMounted
} from 'vue'

import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc
} from 'firebase/firestore'

import { db } from 'src/boot/firebase'

import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'

import {
  USE_MOCK_ORDERS,
  MOCK_ALLOW_ADMIN_WITHOUT_AUTH
} from 'src/config/app'

const auth = useAuthStore()
const toast = useToastStore()

const canManageOrders = computed(
  () =>
    auth.isSuperAdmin ||
    (
      USE_MOCK_ORDERS &&
      MOCK_ALLOW_ADMIN_WITHOUT_AUTH
    )
)

const checkingAdmin = ref(true)
const loading = ref(false)
const saving = ref(false)

const stories = ref([])

const editing = ref(false)
const editingExisting = ref(false)

const displayName = ref('管理員')

function createEmptyStory() {
  return {
    id: '',
    title: '',
    subtitle: '',
    content: '',
    publishAt: '',
    order: stories.value.length + 1,
    enabled: true
  }
}

const storyForm = ref(
  createEmptyStory()
)

/* ---------- date / time ---------- */

function getPart(value, part) {
  const [date = '', time = ''] =
    (value || '').split('T')

  return part === 'date'
    ? date
    : time.slice(0, 5)
}

function setPart(
  target,
  key,
  part,
  value,
  defaultTime
) {
  const [date = '', time = ''] =
    (target[key] || '').split('T')

  const newDate =
    part === 'date'
      ? value
      : date

  const newTime =
    (
      part === 'time'
        ? value
        : time.slice(0, 5)
    ) || defaultTime

  target[key] = newDate
    ? `${newDate}T${newTime}`
    : ''
}

function toInputValue(date) {
  const pad = value =>
    String(value).padStart(2, '0')

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function setPublishNow() {
  storyForm.value.publishAt =
    toInputValue(new Date())
}

function setPublishAfter(days) {
  const date = new Date()

  date.setDate(
    date.getDate() + days
  )

  storyForm.value.publishAt =
    toInputValue(date)
}

const publishSummary = computed(() => {
  if (!storyForm.value.publishAt) {
    return {
      text: '尚未設定公開時間',
      level: 'error'
    }
  }

  const publishAt =
    new Date(
      storyForm.value.publishAt
    )

  if (
    Number.isNaN(
      publishAt.getTime()
    )
  ) {
    return {
      text: '公開時間格式錯誤',
      level: 'error'
    }
  }

  if (publishAt <= new Date()) {
    return {
      text: '目前已公開',
      level: 'ok'
    }
  }

  return {
    text:
      `尚未公開，將於 ${storyForm.value.publishAt.replace('T', ' ')} 自動公開`,
    level: ''
  }
})

/* ---------- preview ---------- */

const previewParagraphs = computed(() =>
  (storyForm.value.content || '')
    .split(/\r?\n/)
    .map(paragraph =>
      paragraph.trim()
    )
    .filter(Boolean)
)

/* ---------- story status ---------- */

function getStoryStatus(story) {
  if (story.enabled === false) {
    return {
      text: '已停用',
      class: 'disabled'
    }
  }

  if (!story.publishAt) {
    return {
      text: '未設定公開時間',
      class: 'disabled'
    }
  }

  const publishAt =
    new Date(story.publishAt)

  if (
    Number.isNaN(
      publishAt.getTime()
    )
  ) {
    return {
      text: '時間錯誤',
      class: 'disabled'
    }
  }

  if (publishAt <= new Date()) {
    return {
      text: '已公開',
      class: 'published'
    }
  }

  return {
    text: '尚未公開',
    class: 'upcoming'
  }
}

/* ---------- formatting ---------- */

function formatDateTime(value) {
  if (!value) return '未設定'

  const date = new Date(value)

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return '格式錯誤'
  }

  return new Intl.DateTimeFormat(
    'zh-TW',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }
  ).format(date)
}

function getPreviewText(content) {
  if (!content) {
    return '尚未輸入故事內容。'
  }

  const text = content
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length <= 100) {
    return text
  }

  return `${text.slice(0, 100)}…`
}

/* ---------- load ---------- */

async function loadStories() {
  loading.value = true

  try {
    const snapshot = await getDocs(
      collection(db, 'partyStories')
    )

    stories.value = snapshot.docs
      .map(document => ({
        id: document.id,
        ...document.data()
      }))
      .sort((a, b) => {
        return (
          (Number(a.order) || 0) -
          (Number(b.order) || 0)
        )
      })

  } catch (error) {
    console.error(
      'Load party stories error:',
      error
    )

    toast.show(
      '舞會故事載入失敗'
    )
  } finally {
    loading.value = false
  }
}

/* ---------- editor ---------- */

function openCreateStory() {
  storyForm.value = {
    ...createEmptyStory()
  }

  editing.value = true
  editingExisting.value = false

  window.scrollTo({
    top: document.body.scrollHeight,
    behavior: 'smooth'
  })
}

function openEditStory(story) {
  storyForm.value = {
    id: story.id,
    title: story.title || '',
    subtitle: story.subtitle || '',
    content: story.content || '',
    publishAt: story.publishAt || '',
    order: Number(story.order) || 0,
    enabled: story.enabled !== false
  }

  editing.value = true
  editingExisting.value = true

  window.scrollTo({
    top: document.body.scrollHeight,
    behavior: 'smooth'
  })
}

function cancelEdit() {
  editing.value = false
  editingExisting.value = false
  storyForm.value = createEmptyStory()
}

/* ---------- save ---------- */

async function saveStory() {
  if (!storyForm.value.title.trim()) {
    toast.show('請填寫故事標題')
    return
  }

  if (!storyForm.value.content.trim()) {
    toast.show('請填寫故事內容')
    return
  }

  if (!storyForm.value.publishAt) {
    toast.show('請設定公開時間')
    return
  }

  saving.value = true

  try {
    const storyId =
      storyForm.value.id ||
      crypto.randomUUID()

    await setDoc(
      doc(
        db,
        'partyStories',
        storyId
      ),
      {
        title:
          storyForm.value.title.trim(),

        subtitle:
          storyForm.value.subtitle.trim(),

        content:
          storyForm.value.content.trim(),

        publishAt:
          storyForm.value.publishAt,

        order:
          Number(storyForm.value.order) || 0,

        enabled:
          storyForm.value.enabled,

        updatedAt:
          new Date(),

        updatedBy:
          displayName.value
      }
    )

    toast.show(
      editingExisting.value
        ? '舞會介紹已更新'
        : '舞會介紹已建立'
    )

    editing.value = false
    editingExisting.value = false

    await loadStories()

  } catch (error) {
    console.error(
      'Save party story error:',
      error
    )

    toast.show(
      '舞會介紹儲存失敗'
    )
  } finally {
    saving.value = false
  }
}

/* ---------- delete ---------- */

async function deleteStory(story) {
  const confirmed =
    window.confirm(
      `確定要刪除「${story.title || '未命名故事'}」嗎？\n\n此操作無法復原。`
    )

  if (!confirmed) {
    return
  }

  try {
    await deleteDoc(
      doc(
        db,
        'partyStories',
        story.id
      )
    )

    toast.show(
      '舞會介紹已刪除'
    )

    if (
      storyForm.value.id === story.id
    ) {
      cancelEdit()
    }

    await loadStories()

  } catch (error) {
    console.error(
      'Delete party story error:',
      error
    )

    toast.show(
      '舞會介紹刪除失敗'
    )
  }
}

/* ---------- admin ---------- */

async function loadAdminProfile() {
  if (!auth.user) return

  try {
    const userDoc = await getDocs(
      collection(db, 'users')
    )

    const profile =
      userDoc.docs.find(
        document =>
          document.id === auth.user.uid
      )

    displayName.value =
      profile?.data()?.name ||
      auth.user.displayName ||
      auth.user.email ||
      '管理員'

  } catch {
    displayName.value =
      auth.user.displayName ||
      auth.user.email ||
      '管理員'
  }
}

onMounted(async () => {
  await loadAdminProfile()

  checkingAdmin.value = false

  if (canManageOrders.value) {
    await loadStories()
  }
})
</script>

<style scoped lang="scss">
@import 'src/css/app.scss';
@import 'src/css/adminpage.scss';
@import 'src/css/intromanagementpage.scss';
</style>