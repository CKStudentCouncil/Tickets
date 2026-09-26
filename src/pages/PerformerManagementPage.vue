<template>
  <div
    v-if="auth.loading"
    class="state-screen"
  >
    <p>載入中...</p>
  </div>

  <div
    v-else-if="!auth.isSuperAdmin"
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

    <!-- =========================
         Header
         ========================= -->

    <div class="page-heading">

      <p class="eyebrow">
        後台管理
      </p>

      <div class="heading-row">

        <div class="heading-copy">

          <h1>
            社團與藝人
          </h1>

          <p class="page-description">
            管理前台「社團與藝人介紹」頁面所顯示的演出單位與藝人資料。
          </p>

        </div>

        <button
          type="button"
          class="btn"
          @click="startCreate"
        >
          新增介紹
        </button>

      </div>

    </div>


    <!-- =========================
         Tabs
         ========================= -->

    <div class="category-tabs">

      <button
        type="button"
        class="category-tab"
        :class="{
          active: activeTab === 'club'
        }"
        @click="activeTab = 'club'"
      >
        <span>
          社團
        </span>

        <small>
          {{ clubItems.length }}
        </small>
      </button>

      <button
        type="button"
        class="category-tab"
        :class="{
          active: activeTab === 'artist'
        }"
        @click="activeTab = 'artist'"
      >
        <span>
          藝人
        </span>

        <small>
          {{ artistItems.length }}
        </small>
      </button>

    </div>


    <!-- =========================
         List
         ========================= -->

    <section class="panel">

      <div class="notify-header">

        <div class="panel-heading-copy">

          <h2>
            {{
              activeTab === 'club'
                ? '社團介紹'
                : '藝人介紹'
            }}
          </h2>

          <p class="panel-copy">
            {{
              activeTab === 'club'
                ? '管理本次舞會參與演出的校內外社團'
                : '管理本次舞會邀請的藝人'
            }}
          </p>

        </div>

        <button
          type="button"
          class="btn-outline"
          @click="startCreate"
        >
          ＋ 新增
        </button>

      </div>


      <p
        v-if="loading"
        class="empty"
      >
        資料載入中...
      </p>


      <div
        v-else-if="currentItems.length === 0"
        class="empty-state"
      >

        <p>
          尚未建立任何
          {{ activeTab === 'club' ? '社團' : '藝人' }}
          介紹。
        </p>

        <button
          type="button"
          class="btn-outline"
          @click="startCreate"
        >
          新增第一筆
        </button>

      </div>


      <div
        v-else
        class="lineup-list"
      >

        <article
          v-for="item in currentItems"
          :key="item.id"
          class="lineup-card"
        >

          <div
            v-if="item.imageUrl"
            class="list-thumbnail"
          >
            <img
              :src="item.imageUrl"
              :alt="item.title || item.name"
              loading="lazy"
            >
          </div>

          <div class="lineup-card-main">

            <div class="lineup-card-top">

              <span
                class="status"
                :class="getStatus(item).class"
              >
                {{ getStatus(item).text }}
              </span>

              <span class="publish-date">
                {{ formatDate(item.publishAt) }}
              </span>

            </div>

            <h3>
              {{ item.title || item.name }}
            </h3>

            <p class="lineup-name">
              {{ item.name }}
            </p>

            <p class="lineup-excerpt">
              {{ getExcerpt(item.content) }}
            </p>

          </div>

          <div class="lineup-card-actions">

            <button
              type="button"
              class="btn-outline"
              @click="editItem(item)"
            >
              編輯
            </button>

            <button
              type="button"
              class="btn-danger"
              @click="removeItem(item)"
            >
              刪除
            </button>

          </div>

        </article>

      </div>

    </section>


    <!-- =========================
         Editor
         ========================= -->

    <section
      v-if="editing"
      ref="editorSection"
      class="panel editor-panel"
    >

      <div class="notify-header">

        <div class="panel-heading-copy">

          <p class="editor-eyebrow">
            {{ isCreating ? 'NEW ENTRY' : 'EDIT ENTRY' }}
          </p>

          <h2>
            {{
              isCreating
                ? `新增${activeTab === 'club' ? '社團' : '藝人'}介紹`
                : '編輯介紹'
            }}
          </h2>

          <p class="panel-copy">
            此內容將依照設定的公開時間自動顯示於前台。
          </p>

        </div>

        <button
          type="button"
          class="btn"
          :disabled="saving || uploading"
          @click="saveItem"
        >
          {{
            uploading
              ? '圖片上傳中...'
              : saving
                ? '儲存中...'
                : '儲存'
          }}
        </button>

      </div>


      <div class="editor-form">

        <!-- Type -->

        <div class="field">

          <span>
            一、類型
          </span>

          <div class="type-selector">

            <button
              type="button"
              class="type-option"
              :class="{
                active: form.type === 'club'
              }"
              @click="changeType('club')"
            >
              社團
            </button>

            <button
              type="button"
              class="type-option"
              :class="{
                active: form.type === 'artist'
              }"
              @click="changeType('artist')"
            >
              藝人
            </button>

          </div>

        </div>


        <!-- Name -->

        <label class="field">

          <span>
            二、{{ form.type === 'club' ? '社團名稱' : '藝人名稱' }}
          </span>

          <input
            v-model="form.name"
            type="text"
            :placeholder="
              form.type === 'club'
                ? '例如：建中民吉'
                : '例如：XXX'
            "
          >

        </label>


        <!-- Title -->

        <label class="field">

          <span>
            三、標題
          </span>

          <input
            v-model="form.title"
            type="text"
            :placeholder="
              form.type === 'club'
                ? '例如：建中民吉'
                : '例如：XXX — CK PARTY NIGHT'
            "
          >

        </label>


        <!-- Image -->

        <div class="field">

          <span>
            四、介紹圖片
          </span>

          <div
            class="image-upload"
            :class="{
              dragging: isDragging
            }"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop"
            @click="openFilePicker"
          >

            <input
              ref="fileInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              @change="handleFileChange"
            >

            <template v-if="form.imageUrl">

              <img
                class="image-preview"
                :src="form.imageUrl"
                :alt="form.title || form.name"
              >

              <div class="image-overlay">

                <span>
                  更換圖片
                </span>

              </div>

            </template>

            <template v-else>

              <div class="upload-placeholder">

                <div class="upload-icon">
                  +
                </div>

                <strong>
                  選擇圖片
                </strong>

                <span>
                  JPG、PNG 或 WEBP
                </span>

                <small>
                  也可以直接將圖片拖曳至此
                </small>

              </div>

            </template>

          </div>


          <div
            v-if="selectedFile"
            class="selected-file"
          >

            <div>

              <strong>
                {{ selectedFile.name }}
              </strong>

              <span>
                {{ formatFileSize(selectedFile.size) }}
              </span>

            </div>

            <button
              type="button"
              @click.stop="clearSelectedFile"
            >
              移除
            </button>

          </div>


          <div
            v-if="uploading"
            class="upload-progress"
          >

            <div class="progress-header">

              <span>
                圖片上傳中
              </span>

              <span>
                {{ uploadProgress }}%
              </span>

            </div>

            <div class="progress-track">

              <div
                class="progress-bar"
                :style="{
                  width: `${uploadProgress}%`
                }"
              />

            </div>

          </div>


          <small class="field-hint">
            建議使用橫式圖片，最大 7 MB。
          </small>

        </div>


        <!-- Content -->

        <label class="field">

          <span>
            五、介紹內容
          </span>

          <textarea
            v-model="form.content"
            rows="14"
            :placeholder="
              form.type === 'club'
                ? '請輸入社團介紹...'
                : '請輸入藝人介紹...'
            "
          />

          <small class="field-hint">
            每一個換行都會在前台呈現為新的段落。
          </small>

        </label>


        <!-- Publish -->

        <div class="field">

          <span>
            六、自動公開時間
          </span>

          <div class="time-inputs">

            <input
              type="date"
              :value="getPart(form.publishAt, 'date')"
              @input="
                setPart(
                  'date',
                  $event.target.value
                )
              "
            >

            <input
              type="time"
              :value="getPart(form.publishAt, 'time')"
              @input="
                setPart(
                  'time',
                  $event.target.value
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
            v-if="publishSummary"
            class="time-summary"
            :class="publishSummary.level"
          >
            {{ publishSummary.text }}
          </p>

        </div>

      </div>


      <!-- Preview -->

      <div class="preview-section">

        <div class="preview-header">

          <div>

            <p class="editor-eyebrow">
              PREVIEW
            </p>

            <h3>
              前台預覽
            </h3>

          </div>

        </div>


        <div class="lineup-preview">

          <div
            v-if="form.imageUrl"
            class="preview-image"
          >
            <img
              :src="form.imageUrl"
              :alt="form.title || form.name"
            >
          </div>

          <div class="preview-meta">

            <span>
              {{
                form.type === 'club'
                  ? 'CLUB'
                  : 'ARTIST'
              }}
            </span>

            <span v-if="form.publishAt">
              {{ formatDate(form.publishAt) }}
            </span>

          </div>

          <h3>
            {{ form.title || '介紹標題' }}
          </h3>

          <p
            v-if="
              form.title &&
              form.name &&
              form.title !== form.name
            "
            class="preview-name"
          >
            {{ form.name }}
          </p>

          <div class="preview-content">

            <p
              v-for="(paragraph, index) in previewParagraphs"
              :key="index"
            >
              {{ paragraph }}
            </p>

            <p
              v-if="previewParagraphs.length === 0"
              class="preview-placeholder"
            >
              介紹內容會顯示於此。
            </p>

          </div>

        </div>

      </div>


      <!-- Actions -->

      <div class="editor-actions">

        <button
          type="button"
          class="btn-outline"
          :disabled="saving || uploading"
          @click="cancelEdit"
        >
          取消
        </button>

        <button
          type="button"
          class="btn"
          :disabled="saving || uploading"
          @click="saveItem"
        >
          {{
            uploading
              ? '圖片上傳中...'
              : saving
                ? '儲存中...'
                : '儲存介紹'
          }}
        </button>

      </div>

    </section>

  </div>
</template>



<script setup>
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { db, functions } from 'src/boot/firebase'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import {
  formatLongDate,
  getDateTimePart as getPart,
  parseDate,
  setDateTimePart,
  startOfDayInputValue,
  toDateTimeInputValue
} from 'src/utils/datetime'
import { excerpt as getExcerpt, splitParagraphs } from 'src/utils/text'

const auth = useAuthStore()
const toast = useToastStore()

const loading = ref(true)

const saving = ref(false)
const uploading = ref(false)

const uploadProgress = ref(0)

const activeTab = ref('club')

const items = ref([])

const editing = ref(false)
const isCreating = ref(false)
const editingId = ref(null)


const fileInput = ref(null)
const editorSection = ref(null)

const selectedFile = ref(null)

const isDragging = ref(false)

const oldImageUrl = ref('')
const oldImageStoragePath = ref('')

const localPreviewUrl = ref('')

const form = ref(
  createEmptyForm('club')
)


const clubItems = computed(() =>
  items.value
    .filter(
      item =>
        item.type === 'club'
    )
    .sort(sortItems)
)

const artistItems = computed(() =>
  items.value
    .filter(
      item =>
        item.type === 'artist'
    )
    .sort(sortItems)
)

const currentItems = computed(() =>
  activeTab.value === 'club'
    ? clubItems.value
    : artistItems.value
)

const previewParagraphs = computed(() => splitParagraphs(form.value.content))

const publishSummary = computed(() => {
  if (!form.value.publishAt) {
    return {
      text: '尚未設定公開時間。',
      level: 'error'
    }
  }

  const date = parseDate(form.value.publishAt)

  if (!date) {
    return {
      text: '公開時間格式錯誤。',
      level: 'error'
    }
  }

  if (
    date <= new Date()
  ) {
    return {
      text:
        `將立即公開：${formatDateTime(
          form.value.publishAt
        )}`,
      level: 'ok'
    }
  }

  return {
    text:
      `將於 ${formatDateTime(
        form.value.publishAt
      )} 自動公開。`,
    level: ''
  }
})

onMounted(() => {
  if (auth.isSuperAdmin) loadItems()
})

onBeforeUnmount(() => {
  revokeLocalPreview()
})

function createEmptyForm(type = 'club') {
  return {
    type,
    name: '',
    title: '',
    content: '',
    imageUrl: '',
    publishAt: ''
  }
}

async function scrollToEditor() {
  await nextTick()

  requestAnimationFrame(() => {
    editorSection.value?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    })
  })
}

function startCreate() {
  isCreating.value = true
  editing.value = true
  editingId.value = null

  selectedFile.value = null

  oldImageUrl.value = ''
  oldImageStoragePath.value = ''

  revokeLocalPreview()

  form.value =
    createEmptyForm(
      activeTab.value
    )

  scrollToEditor()
}

function editItem(item) {
  isCreating.value = false
  editing.value = true
  editingId.value = item.id

  selectedFile.value = null

  oldImageUrl.value =
    item.imageUrl || ''

  oldImageStoragePath.value =
    item.imageStoragePath ||
    item.imageFileId ||
    ''

  revokeLocalPreview()

  form.value = {
    type:
      item.type ||
      activeTab.value,

    name:
      item.name ||
      '',

    title:
      item.title ||
      '',

    content:
      item.content ||
      '',

    imageUrl:
      item.imageUrl ||
      '',

    publishAt:
      normalizePublishAt(
        item.publishAt
      )
  }

  activeTab.value =
    form.value.type

  scrollToEditor()
}

function cancelEdit() {
  revokeLocalPreview()

  editing.value = false
  editingId.value = null
  isCreating.value = false

  selectedFile.value = null

  oldImageUrl.value = ''
  oldImageStoragePath.value = ''

  form.value =
    createEmptyForm(
      activeTab.value
    )

  uploadProgress.value = 0

  isDragging.value = false

  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

function changeType(type) {
  form.value.type = type
  activeTab.value = type
}

function openFilePicker() {
  if (
    saving.value ||
    uploading.value
  ) {
    return
  }

  fileInput.value?.click()
}

function handleFileChange(event) {
  const file =
    event.target.files?.[0]

  if (!file) {
    return
  }

  selectFile(file)
}

function handleDrop(event) {
  isDragging.value = false

  const file =
    event.dataTransfer?.files?.[0]

  if (!file) {
    return
  }

  selectFile(file)
}

function selectFile(file) {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp'
  ]

  if (
    !allowedTypes.includes(
      file.type
    )
  ) {
    toast.show(
      '只允許 JPG、PNG 或 WEBP 圖片。'
    )

    return
  }

  // callable payload limit is 10 MB and base64 adds ~33%
  const maxSize =
    7 * 1024 * 1024

  if (
    file.size > maxSize
  ) {
    toast.show(
      '圖片大小不能超過 7 MB。'
    )

    return
  }

  revokeLocalPreview()

  selectedFile.value = file

  localPreviewUrl.value =
    URL.createObjectURL(file)

  form.value.imageUrl =
    localPreviewUrl.value
}

function clearSelectedFile() {
  revokeLocalPreview()

  selectedFile.value = null

  form.value.imageUrl =
    oldImageUrl.value || ''

  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

function revokeLocalPreview() {
  if (
    localPreviewUrl.value
  ) {
    URL.revokeObjectURL(
      localPreviewUrl.value
    )

    localPreviewUrl.value = ''
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader =
      new FileReader()

    reader.onload = () => {
      const result =
        String(
          reader.result || ''
        )

      const base64 =
        result.split(',')[1] || ''

      resolve(base64)
    }

    reader.onerror = () => {
      reject(
        reader.error ||
        new Error(
          '讀取檔案失敗'
        )
      )
    }

    reader.readAsDataURL(file)
  })
}

async function uploadImage(itemId) {
  if (!selectedFile.value) {
    return {
      url:
        form.value.imageUrl || '',

      storagePath:
        oldImageStoragePath.value || ''
    }
  }

  const file =
    selectedFile.value

  uploading.value = true
  uploadProgress.value = 10

  try {
    const fileData =
      await fileToBase64(file)

    uploadProgress.value = 55

    const uploadLineupImage =
      httpsCallable(
        functions,
        'uploadLineupImage'
      )

    const response =
      await uploadLineupImage({
        itemId,
        filename:
          file.name,
        contentType:
          file.type,
        fileData
      })

    uploadProgress.value = 100

    return {
      url:
        response.data?.url || '',

      storagePath:
        response.data?.storagePath ||
        response.data?.fileId ||
        ''
    }
  } catch (error) {
    console.error(
      'Storage upload failed:',
      error
    )

    const message =
      error?.details ||
      error?.message ||
      '圖片上傳失敗，請稍後再試。'

    throw new Error(
      `圖片上傳失敗：${message}`
    )
  } finally {
    uploading.value = false
  }
}

async function saveItem() {
  if (
    !form.value.name.trim()
  ) {
    toast.show(
      '請輸入名稱。'
    )

    return
  }

  if (
    !form.value.title.trim()
  ) {
    toast.show(
      '請輸入標題。'
    )

    return
  }

  if (
    !form.value.content.trim()
  ) {
    toast.show(
      '請輸入介紹內容。'
    )

    return
  }

  if (
    !form.value.publishAt
  ) {
    toast.show(
      '請設定公開時間。'
    )

    return
  }

  if (!parseDate(form.value.publishAt)) {
    toast.show(
      '公開時間格式錯誤。'
    )

    return
  }

  saving.value = true

  try {
    const basePayload = {
      type:
        form.value.type,

      name:
        form.value.name.trim(),

      title:
        form.value.title.trim(),

      content:
        form.value.content.trim(),

      publishAt:
        form.value.publishAt,

      updatedAt:
        serverTimestamp(),

      updatedBy:
        auth.displayName
    }

    let itemId

    if (
      !editingId.value
    ) {
      const newDoc =
        await addDoc(
          collection(
            db,
            'partyLineup'
          ),
          {
            ...basePayload,

            imageUrl:
              '',

            imageStoragePath:
              '',

            createdAt:
              serverTimestamp(),

            createdBy:
              auth.displayName
          }
        )

      itemId =
        newDoc.id
    } else {
      itemId =
        editingId.value
    }

    let imageUrl =
      oldImageUrl.value || ''

    let imageStoragePath =
      oldImageStoragePath.value || ''

    if (
      selectedFile.value
    ) {
      const uploaded =
        await uploadImage(
          itemId
        )

      imageUrl =
        uploaded.url

      imageStoragePath =
        uploaded.storagePath
    }

    await updateDoc(
      doc(
        db,
        'partyLineup',
        itemId
      ),
      {
        ...basePayload,

        imageUrl:
          imageUrl &&
          !imageUrl.startsWith(
            'blob:'
          )
            ? imageUrl
            : '',

        imageStoragePath:
          imageStoragePath || ''
      }
    )

    if (
      selectedFile.value &&
      oldImageStoragePath.value &&
      oldImageStoragePath.value !==
        imageStoragePath
    ) {
      await deleteImageByStoragePath(
        oldImageStoragePath.value
      )
    }

    toast.show(
      isCreating.value
        ? '介紹已建立。'
        : '介紹已更新。'
    )

    await loadItems()

    cancelEdit()
  } catch (error) {
    console.error(
      'Failed to save lineup item:',
      error
    )

    toast.show(
      error?.message ||
      '儲存失敗，請稍後再試。'
    )
  } finally {
    saving.value = false
    uploading.value = false
  }
}

async function removeItem(item) {
  const confirmed =
    window.confirm(
      `確定要刪除「${
        item.title ||
        item.name
      }」嗎？\n\n此操作會同時刪除 Storage 上的圖片，且無法復原。`
    )

  if (!confirmed) {
    return
  }

  try {
    await deleteDoc(
      doc(
        db,
        'partyLineup',
        item.id
      )
    )

    await deleteImageByStoragePath(
      item.imageStoragePath ||
      item.imageFileId ||
      ''
    )

    items.value =
      items.value.filter(
        current =>
          current.id !== item.id
      )

    if (
      editingId.value === item.id
    ) {
      cancelEdit()
    }

    toast.show(
      '介紹已刪除。'
    )
  } catch (error) {
    console.error(
      'Failed to delete lineup item:',
      error
    )

    toast.show(
      '刪除失敗，請稍後再試。'
    )
  }
}


async function loadItems() {
  loading.value = true

  try {
    const snapshot =
      await getDocs(
        collection(
          db,
          'partyLineup'
        )
      )

    items.value =
      snapshot.docs.map(
        document => ({
          id:
            document.id,

          ...document.data()
        })
      )
  } catch (error) {
    console.error(
      'Failed to load lineup:',
      error
    )

    toast.show(
      '無法載入社團與藝人資料。'
    )
  } finally {
    loading.value = false
  }
}

async function deleteImageByStoragePath(
  storagePath
) {
  if (!storagePath) {
    return
  }

  try {
    const deleteLineupImage =
      httpsCallable(
        functions,
        'deleteLineupImage'
      )

    await deleteLineupImage({
      storagePath
    })
  } catch (error) {
    console.warn(
      'Failed to delete image:',
      error
    )
  }
}

function sortItems(a, b) {
  return (parseDate(b.publishAt)?.getTime() || 0) - (parseDate(a.publishAt)?.getTime() || 0)
}

function getStatus(item) {
  const date = parseDate(item.publishAt)

  if (!item.publishAt) return { text: '未設定', class: 'draft' }
  if (!date) return { text: '時間錯誤', class: 'draft' }
  if (date > new Date()) return { text: '待公開', class: 'upcoming' }

  return { text: '已公開', class: 'published' }
}

function normalizePublishAt(value) {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 16)
  return value?.toDate ? toDateTimeInputValue(value.toDate()) : ''
}

function setPart(part, value) {
  if (!value) return
  form.value.publishAt = setDateTimePart(form.value.publishAt, part, value)
}

function setPublishNow() {
  form.value.publishAt = toDateTimeInputValue(new Date())
}

// publish at Taiwan midnight `days` from today
function setPublishAfter(days) {
  form.value.publishAt = startOfDayInputValue(days)
}

function formatDate(value) {
  if (!value) return '未設定'
  return formatLongDate(value) || '時間錯誤'
}

function formatDateTime(value) {
  const date = parseDate(value)
  if (!date) return ''

  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function formatFileSize(size) {
  if (
    size < 1024
  ) {
    return `${size} B`
  }

  if (
    size <
    1024 * 1024
  ) {
    return `${(
      size / 1024
    ).toFixed(1)} KB`
  }

  return `${(
    size /
    1024 /
    1024
  ).toFixed(1)} MB`
}
</script>


<style scoped>

@import 'src/css/app.scss';
@import 'src/css/adminpage.scss';
@import 'src/css/performermanagementpage.scss';
</style>