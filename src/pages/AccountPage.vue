<template>
  <div
    v-if="!canAccessAdmin"
    class="state"
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
    v-else-if="loading"
    class="state"
  >
    載入中...
  </div>

  <div
    v-else
    class="account-page"
  >
    <div class="header-row">
      <h1>帳號管理</h1>
      <div class="header-actions">
        <button
          type="button"
          class="btn-outline"
          @click="openCreateModal"
        >
          新增使用者
        </button>
        <button
          type="button"
          class="btn-outline danger-outline"
          @click="openDeleteAllModal"
        >
          刪除所有使用者
        </button>
        <button
          type="button"
          class="btn-outline"
          @click="$router.push('/admin')"
        >
          返回後台
        </button>
      </div>
    </div>

    <div class="stats">
      <div class="stat-card"><strong class="num">{{ users.length }}</strong><span>總使用者</span></div>
      <div class="stat-card"><strong class="num">{{ users.filter((u) => u.role === 'super_admin').length }}</strong><span>系統管理員</span></div>
      <div class="stat-card"><strong class="num">{{ users.filter((u) => u.role === 'admin').length }}</strong><span>建班幹部</span></div>
      <div class="stat-card"><strong class="num">{{ users.filter((u) => u.role === 'manager').length }}</strong><span>友校幹部</span></div>
    </div>

    <div class="filters panel">
      <input
        v-model="searchTerm"
        type="search"
        placeholder="搜尋使用者 (Email 或姓名)"
      >
      <select v-model="filterRole">
        <option value="all">全部角色</option>
        <option value="super_admin">系統管理員</option>
        <option value="admin">建班幹部</option>
        <option value="manager">友校幹部</option>
      </select>
    </div>

    <div class="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>姓名</th>
            <th>角色</th>
            <th>狀態</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in filteredUsers"
            :key="u.id"
          >
            <td class="mono">{{ u.email }}</td>
            <td>{{ u.name || u.displayName || '未設定' }}</td>
            <td>{{ roleLabel(u.role) }}</td>
            <td>
              <span v-if="u.pending" class="badge pending">待啟用</span>
              <span v-else class="badge active">已啟用</span>
            </td>
            <td>
              <button
                type="button"
                class="btn-sm"
                @click="openModal(u)"
              >
                管理
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="filteredUsers.length === 0" class="empty">找不到符合條件的使用者</p>
    </div>

    <!-- 使用者管理 Modal -->
    <div
      v-if="showModal && selectedUser"
      class="modal-overlay"
      @click.self="closeModal"
    >
      <div class="modal">
        <h2>使用者管理</h2>
        <p><strong>Email：</strong><span class="mono">{{ selectedUser.email }}</span></p>
        <p><strong>姓名：</strong>{{ selectedUser.name || selectedUser.displayName || '未設定' }}</p>
        <p v-if="selectedUser.pending" class="hint warn">
          此帳號尚未啟用，使用者需以此 Email 透過 Google 登入才會建立實際登入身分並自動綁定此角色。
        </p>

        <label class="field-label" for="role-select">角色</label>
        <select
          id="role-select"
          v-model="pendingRole"
          :disabled="selectedUser.id === auth.user?.uid"
        >
          <option value="manager">友校幹部</option>
          <option value="admin">建班幹部</option>
          <option value="super_admin">系統管理員</option>
        </select>
        <p v-if="selectedUser.id === auth.user?.uid" class="hint">
          無法變更自己的角色
        </p>
        <p v-else-if="isLastSuperAdmin(selectedUser) && pendingRole !== 'super_admin'" class="hint warn">
          這是最後一位系統管理員，無法降級
        </p>

        <button
          type="button"
          class="btn"
          :disabled="!canApplyRole"
          @click="applyRole(selectedUser.id)"
        >
          套用角色變更
        </button>

        <button
          type="button"
          class="btn danger"
          :disabled="selectedUser.id === auth.user?.uid || selectedUser.role === 'super_admin'"
          @click="deleteUser(selectedUser.id)"
        >
          刪除使用者
        </button>
        <button
          type="button"
          class="btn-outline"
          @click="closeModal"
        >
          取消
        </button>
      </div>
    </div>

    <!-- 新增使用者 Modal -->
    <div
      v-if="showCreateModal"
      class="modal-overlay"
      @click.self="closeCreateModal"
    >
      <div class="modal">
        <h2>新增使用者</h2>
        <p class="hint">
          這裡不會設定密碼。系統會建立一筆「待啟用」的使用者資料，
          該使用者需使用此 Email 透過 <strong>Google 登入</strong>，
          系統會在登入當下自動將其 Firebase Authentication 帳號與這筆角色資料綁定並啟用。
        </p>

        <label class="field-label" for="new-email">Email</label>
        <input
          id="new-email"
          v-model="newUser.email"
          type="email"
          placeholder="user@example.com"
        >

        <label class="field-label" for="new-name">姓名（選填）</label>
        <input
          id="new-name"
          v-model="newUser.name"
          type="text"
          placeholder="顯示名稱"
        >

        <label class="field-label" for="new-role">角色</label>
        <select id="new-role" v-model="newUser.role">
          <option value="manager">友校幹部</option>
          <option value="admin">建班幹部</option>
          <option value="super_admin">系統管理員</option>
        </select>

        <p v-if="createError" class="hint warn">{{ createError }}</p>

        <button
          type="button"
          class="btn"
          :disabled="creating || !isValidEmail(newUser.email)"
          @click="createUser"
        >
          {{ creating ? '建立中...' : '建立待啟用帳號' }}
        </button>
        <button
          type="button"
          class="btn-outline"
          :disabled="creating"
          @click="closeCreateModal"
        >
          取消
        </button>
      </div>
    </div>

    <!-- 刪除所有使用者 Modal -->
    <div
      v-if="showDeleteAllModal"
      class="modal-overlay"
      @click.self="closeDeleteAllModal"
    >
      <div class="modal">
        <h2>刪除所有使用者</h2>
        <p class="hint warn">
          此操作將刪除除了你自己以外的所有使用者資料，且無法復原。
          請注意：這只會刪除資料庫中的使用者資料，不會刪除 Firebase
          Authentication 中已綁定 Google 登入的帳號（需要後端 Admin SDK / Cloud Function
          才能一併刪除登入帳號，避免產生無法登入卻仍存在的孤兒帳號）。
        </p>
        <p>
          請輸入 <strong class="mono">DELETE ALL</strong> 以確認：
        </p>
        <input
          v-model="deleteAllConfirmText"
          type="text"
          placeholder="DELETE ALL"
        >
        <button
          type="button"
          class="btn danger"
          :disabled="deleteAllConfirmText !== 'DELETE ALL' || deletingAll"
          @click="deleteAllUsers"
        >
          {{ deletingAll ? '刪除中...' : '確認刪除所有使用者' }}
        </button>
        <button
          type="button"
          class="btn-outline"
          :disabled="deletingAll"
          @click="closeDeleteAllModal"
        >
          取消
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch
} from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { USE_MOCK_ORDERS, MOCK_ALLOW_ADMIN_WITHOUT_AUTH } from 'src/config/app'

const auth = useAuthStore()
const canAccessAdmin = computed(
  () => auth.isSuperAdmin || (USE_MOCK_ORDERS && MOCK_ALLOW_ADMIN_WITHOUT_AUTH)
)
const toast = useToastStore()

const users = ref([])
const loading = ref(true)
const searchTerm = ref('')
const filterRole = ref('all')
const selectedUser = ref(null)
const showModal = ref(false)
const pendingRole = ref('manager')

const showCreateModal = ref(false)
const creating = ref(false)
const createError = ref('')
const newUser = ref({ email: '', name: '', role: 'manager' })

const showDeleteAllModal = ref(false)
const deleteAllConfirmText = ref('')
const deletingAll = ref(false)

const filteredUsers = computed(() =>
  users.value.filter((user) => {
    const q = searchTerm.value.toLowerCase()
    const matchesSearch =
      !q ||
      user.email?.toLowerCase().includes(q) ||
      user.name?.toLowerCase().includes(q) ||
      user.displayName?.toLowerCase().includes(q)
    const matchesRole = filterRole.value === 'all' || user.role === filterRole.value
    return matchesSearch && matchesRole
  })
)

const canApplyRole = computed(() => {
  if (!selectedUser.value) return false
  if (selectedUser.value.id === auth.user?.uid) return false
  if (pendingRole.value === selectedUser.value.role) return false
  if (isLastSuperAdmin(selectedUser.value) && pendingRole.value !== 'super_admin') return false
  return true
})

function roleLabel(role) {
  if (role === 'super_admin') return '系統管理員'
  if (role === 'admin') return '建班幹部'
  if (role === 'manager') return '友校幹部'
  return role || '未設定'
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim())
}

function isLastSuperAdmin(user) {
  if (user.role !== 'super_admin') return false
  return users.value.filter((u) => u.role === 'super_admin').length === 1
}

onMounted(async () => {
  if (!canAccessAdmin.value) {
    loading.value = false
    return
  }
  await loadUsers()
})

async function loadUsers() {
  loading.value = true
  try {
    const userSnap = await getDocs(collection(db, 'users'))
    const pendingSnap = await getDocs(collection(db, 'pendingUsers'))

    users.value = [
      ...userSnap.docs.map((d) => ({ id: d.id, ...d.data(), role: d.data().role || 'manager' })),
      ...pendingSnap.docs.map((d) => ({ id: d.id, ...d.data(), role: d.data().role || 'manager' }))
    ]
  } catch {
    toast.show('獲取使用者資料失敗')
  } finally {
    loading.value = false
  }
}

function openModal(user) {
  selectedUser.value = user
  pendingRole.value = user.role || 'manager'
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  selectedUser.value = null
}

async function applyRole(userId) {
  const user = users.value.find((u) => u.id === userId)
  if (!user) return
  const newRole = pendingRole.value
  try {
    await updateDoc(doc(db, 'users', userId), {
      role: newRole,
      updatedAt: new Date().toISOString()
    })
    users.value = users.value.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
    if (selectedUser.value?.id === userId) {
      selectedUser.value = { ...selectedUser.value, role: newRole }
    }
    toast.show(`角色已更新為${roleLabel(newRole)}`)
  } catch {
    toast.show('更新權限失敗')
  }
}

async function deleteUser(userId) {
  if (!window.confirm('確定要刪除此使用者嗎？')) return
  try {
    await deleteDoc(doc(db, 'users', userId))
    users.value = users.value.filter((u) => u.id !== userId)
    closeModal()
    toast.show('使用者已刪除')
  } catch {
    toast.show('刪除失敗')
  }
}

function openCreateModal() {
  newUser.value = { email: '', name: '', role: 'manager' }
  createError.value = ''
  showCreateModal.value = true
}

function closeCreateModal() {
  if (creating.value) return
  showCreateModal.value = false
}

async function createUser() {
  createError.value = ''
  const email = newUser.value.email.trim().toLowerCase()

  if (!isValidEmail(email)) {
    createError.value = 'Email 格式不正確'
    return
  }
  if (users.value.some((u) => u.email?.toLowerCase() === email)) {
    createError.value = '此 Email 已建立過帳號'
    return
  }

  creating.value = true
  try {
    const pendingId = doc(collection(db, 'users')).id
    const record = {
      email,
      name: newUser.value.name || '',
      role: newUser.value.role,
      uid: null,
      pending: true,
      createdAt: new Date().toISOString()
    }
    await setDoc(
    doc(db, 'pendingUsers', pendingId),
    record
  )

    users.value = [...users.value, { id: pendingId, ...record }]

    toast.show('已建立待啟用帳號，該使用者需以此 Email 使用 Google 登入以啟用')
    showCreateModal.value = false
  } catch {
    createError.value = '建立帳號失敗，請稍後再試'
  } finally {
    creating.value = false
  }
}

function openDeleteAllModal() {
  deleteAllConfirmText.value = ''
  showDeleteAllModal.value = true
}

function closeDeleteAllModal() {
  if (deletingAll.value) return
  showDeleteAllModal.value = false
}

async function deleteAllUsers() {
  if (deleteAllConfirmText.value !== 'DELETE ALL') return
  deletingAll.value = true
  try {
    const targets = users.value.filter((u) => u.id !== auth.user?.uid)
    const batch = writeBatch(db)
    targets.forEach((u) => batch.delete(doc(db, 'users', u.id)))
    await batch.commit()

    users.value = users.value.filter((u) => u.id === auth.user?.uid)
    showDeleteAllModal.value = false
    toast.show(`已刪除 ${targets.length} 位使用者的資料`)
  } catch {
    toast.show('刪除失敗')
  } finally {
    deletingAll.value = false
  }
}
</script>

<style scoped>
@import 'src/css/accountpage.scss';
</style>