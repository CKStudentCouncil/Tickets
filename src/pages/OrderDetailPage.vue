<template>
  <div class="detail-page">
    <div v-if="loading && !order && !cancelledOrder" class="state-screen" role="status">
      <p>載入訂單中...</p>
    </div>

    <div v-else-if="loadError && !order && !cancelledOrder" class="state-screen" role="alert">
      <h1>目前無法載入訂單</h1>
      <p>請檢查連線後重試</p>
      <button type="button" class="btn" @click="loadOrder">重新載入</button>
    </div>

    <!-- ---------- cancelled (functions/lib/orderCancel.js) ---------- -->
    <main v-else-if="!order && cancelledOrder" class="detail-content">
      <header class="page-heading">
        <p class="eyebrow">
          CK PARTY NIGHT · {{ isAdminView ? 'STAFF VIEW' : 'CUSTOMER VIEW' }}
        </p>
        <h1>訂單已取消</h1>
        <p class="heading-meta" style="margin-bottom: 2ch;">
          ORDER <span class="mono">{{ cancelledOrder.id }}</span>
        </p>
        <div class="heading-actions">
          <button type="button" class="btn-outline" @click="goBack">返回</button>
          <button
            v-if="isAdminView"
            type="button"
            class="btn"
            @click="router.push({ name: scanDesk.active ? 'admin-scan-desk' : 'admin-scan' })"
          >
            {{ scanDesk.active ? '回到接收畫面' : '掃描下一張' }}
          </button>
        </div>
      </header>

      <p v-if="isAdminView" class="qr-check danger cancelled-alert" role="alert">
        ⚠ 此訂單已取消，QR Code 已失效，不得領票
      </p>

      <section class="panel" :style="isAdminView ? '' : 'border-top: none; margin-top: 0; padding-top: 0;'">
        <h2>取消資訊</h2>
        <dl class="info-list">
          <div>
            <dt>取消原因</dt>
            <dd>{{ CANCEL_REASONS[cancelledOrder.cancelReason] || '—' }}</dd>
          </div>
          <div v-if="isAdminView && cancelledOrder.cancelNote">
            <dt>說明</dt>
            <dd>{{ cancelledOrder.cancelNote }}</dd>
          </div>
          <div>
            <dt>取消時間</dt>
            <dd class="num">{{ formatDateTime(cancelledOrder.cancelledAt) }}</dd>
          </div>
          <div v-if="isAdminView && cancelledOrder.cancelledByName">
            <dt>取消人員</dt>
            <dd>{{ cancelledOrder.cancelledByName }}</dd>
          </div>
          <div v-if="isAdminView && cancelledOrder.cancelEmailStatus">
            <dt>取消通知信</dt>
            <dd>
              {{ CANCEL_EMAIL_LABELS[cancelledOrder.cancelEmailStatus] || cancelledOrder.cancelEmailStatus }}
              <span v-if="cancelledOrder.cancelEmailError" class="mono">（{{ cancelledOrder.cancelEmailError }}）</span>
            </dd>
          </div>
          <div>
            <dt>訂單金額</dt>
            <dd class="num">NT$ {{ Number(cancelledOrder.finalTotal ?? 0).toLocaleString() }}・{{ cancelledOrder.paid ? '已付款' : '未付款' }}</dd>
          </div>
          <div v-if="cancelledOrder.paid">
            <dt>退款</dt>
            <dd>
              {{ REFUND_STATUS_LABELS[cancelledOrder.refundStatus] || '—' }}
              <span v-if="cancelledOrder.refundAmount" class="num">NT$ {{ Number(cancelledOrder.refundAmount).toLocaleString() }}</span>
              <span v-if="cancelledOrder.refundStatus === 'done' && cancelledOrder.refundedAt" class="num">・{{ formatDateTime(cancelledOrder.refundedAt) }}</span>
            </dd>
          </div>
        </dl>
        <p v-if="!isAdminView && cancelledOrder.refundStatus === 'pending'" class="panel-copy">
          退款將依主辦單位公告之時間、地點及方式辦理；如有疑問請聯繫建國中學班聯會
        </p>
      </section>

      <section class="panel">
        <h2>票券明細</h2>
        <ul v-if="(cancelledOrder.items || []).length" class="product-stats">
          <li v-for="(item, index) in cancelledOrder.items || []" :key="item.id || index">
            <span>{{ item.name }}</span>
            <span class="item-meta">
              <span class="num">× {{ item.quantity }}</span>
              <strong class="num">
                NT$ {{ (Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString() }}
              </strong>
            </span>
          </li>
        </ul>
        <dl v-if="isAdminView" class="info-list">
          <div v-if="cancelledOrder.customerName">
            <dt>購票人</dt>
            <dd>{{ cancelledOrder.customerName }}</dd>
          </div>
          <div v-if="cancelledOrder.customerEmail">
            <dt>Email</dt>
            <dd class="mono">{{ cancelledOrder.customerEmail }}</dd>
          </div>
          <div v-if="cancelledOrder.customerPhone">
            <dt>聯絡電話</dt>
            <dd class="mono">{{ cancelledOrder.customerPhone }}</dd>
          </div>
        </dl>
      </section>
    </main>

    <div v-else-if="!order" class="state-screen">
      <p class="eyebrow">CK PARTY NIGHT</p>
      <h1>找不到訂單</h1>
      <p v-if="isAdminView">此訂單不存在</p>
      <p v-else>此訂單不存在，或不是以目前登入的帳號（{{ auth.email }}）訂購</p>

      <button type="button" class="btn" @click="goBack">返回</button>
    </div>

    <main v-else class="detail-content" :aria-busy="loading">
      <div v-if="loadError" class="qr-check danger" role="alert">
        <span>無法更新訂單，目前顯示上次載入的資料。</span>
        <button type="button" :disabled="loading" @click="loadOrder">重新載入</button>
      </div>

      <!-- ---------- heading ---------- -->
      <header class="page-heading">
        <p class="eyebrow">
          CK PARTY NIGHT · {{ isAdminView ? 'STAFF VIEW' : 'CUSTOMER VIEW' }}
        </p>
        <h1>訂單詳情</h1>
        <p class="heading-meta" style="margin-bottom: 2ch;">
          ORDER <span class="mono">{{ order.id }}</span>
        </p>
        <div class="heading-actions">
          <button type="button" class="btn-outline" @click="goBack">返回</button>
          <button
            v-if="isAdminView"
            type="button"
            class="btn"
            @click="router.push({ name: scanDesk.active ? 'admin-scan-desk' : 'admin-scan' })"
          >
            {{ scanDesk.active ? '回到接收畫面' : '掃描下一張' }}
          </button>
        </div>
      </header>

      <!-- ---------- status / check-in ---------- -->
      <section class="panel" style="border-top: none; margin-top: 0; padding-top: 0;">
        <div class="panel-head">
          <h2>{{ isAdminView ? '領票作業' : '訂單狀態' }}</h2>
          <span v-if="isAdminView" class="panel-tag">CHECK-IN DESK</span>
        </div>

        <template v-if="isAdminView">
          <!-- 領票檢查: one list, one action. The ticket QR code, then who
               collects (the student card for 限建中在學學生 types, the student
               check for types sold to students first); either may come first -->
          <div v-if="!order.delivered" class="pickup-checks">
            <p class="pickup-buyer">
              <strong>{{ order.customerName || '（未填姓名）' }}</strong>
              <span v-if="buyerTypeLabel">・{{ buyerTypeLabel }}</span>
              <span v-if="itemsSummary">・{{ itemsSummary }}</span>
            </p>

            <div class="check-row" :class="codeDone ? 'done' : qrCheck === 'mismatch' ? 'bad' : 'wait'">
              <span class="check-mark" aria-hidden="true">{{ codeDone ? '✓' : qrCheck === 'mismatch' ? '!' : '1' }}</span>
              <div class="check-body">
                <p class="check-title">票券 QR Code</p>
                <p v-if="qrCheck === 'ok'" class="check-text">驗證碼相符</p>
                <p v-else-if="codeDone" class="check-text">忘了 QR Code：以學生證代替（管理員）</p>
                <p v-else-if="qrCheck === 'mismatch'" class="check-text">驗證碼不符，可能是偽造的 QR Code。請重新掃描</p>
                <p v-else class="check-text">{{ waitingText('qr') }}</p>
                <p v-if="!codeDone && cardReady && !auth.isAdmin" class="check-hint">忘了 QR Code？請管理員登入處理，可用學生證代替</p>
              </div>
            </div>

            <div v-if="idRow" class="check-row" :class="idRowState">
              <span class="check-mark" aria-hidden="true">{{ idRowState === 'done' ? '✓' : idRowState === 'bad' ? '!' : '2' }}</span>
              <div class="check-body">
                <p class="check-title">{{ idRowTitle }}</p>
                <template v-if="studentCard?.match">
                  <p class="check-text">學號 <strong class="mono">{{ studentCard.id }}</strong> 與訂單 Email 相符</p>
                  <p class="check-hint">看一下照片是不是本人、背面有沒有本學期註冊章</p>
                </template>
                <p v-else-if="studentCard" class="check-text" role="alert">
                  學號 <strong class="mono">{{ studentCard.id }}</strong> 不是這筆訂單的帳號（{{ order.customerEmail || '沒有 Email' }}），請掃購票人本人的學生證
                </p>
                <p v-else-if="needsCard && exceptionReady" class="check-text">以{{ idMethodLabel }}查驗{{ idNote.trim() ? `：${idNote.trim()}` : '' }}</p>
                <p v-else-if="needsCard" class="check-text">{{ waitingText('card') }}</p>
                <template v-else-if="needsIdCheck">
                  <p class="check-text">學生身分購票：請購票人出示學生證（背面有本學期註冊章）或酷課雲，資格不符不得領票</p>
                  <p v-if="idCheck?.campus" class="check-hint">建中學生證也可以用下方按鈕掃描，自動核對學號</p>
                </template>

                <template v-if="needsCard && !cardReady">
                  <button v-if="!exceptionOpen" type="button" class="link-button" @click="exceptionOpen = true">
                    沒有學生證？其他方式查驗
                  </button>
                  <div v-else class="id-exception">
                    <label>
                      查驗方式
                      <select v-model="idMethod">
                        <option value="">請選擇</option>
                        <option v-for="method in ID_CHECK_METHODS" :key="method.value" :value="method.value">{{ method.label }}</option>
                      </select>
                    </label>
                    <label>
                      說明{{ idMethod === 'other' ? '（必填）' : '（選填）' }}
                      <input v-model="idNote" :maxlength="ID_NOTE_MAX" placeholder="例如：學生證補辦中，核對身分證">
                    </label>
                    <button type="button" class="link-button" @click="closeException">取消</button>
                  </div>
                </template>
              </div>
            </div>

            <div v-if="otherScan" class="other-order" role="alert">
              <p>{{ otherScan.from === 'phone' ? '手機掃到' : '掃到' }}另一張訂單 <span class="mono">{{ otherScan.orderId }}</span>{{ otherScan.studentId ? `（學號 ${otherScan.studentId}）` : '' }}</p>
              <div class="other-actions">
                <button type="button" class="btn-sm" @click="openOtherScan">切換到那張訂單</button>
                <button type="button" class="btn-sm muted" @click="dismissOtherScan">留在這張</button>
              </div>
            </div>

            <div v-if="scannerWanted" class="pickup-scanner">
              <StudentCardScanner
                v-if="scannerOn && (wantQr || wantCard || optionalScan)"
                :key="order.id"
                :card="wantCard || (optionalCard && (optionalScan || wantQr))"
                :qr="wantQr"
                :lookup="false"
                :device-id="savedCamera()"
                :title="(wantCard || optionalCard) && wantQr ? '掃描 QR Code 或學生證' : wantCard || optionalCard ? '掃描學生證' : '掃描票券 QR Code'"
                :prompt="scannerPrompt"
                compact
                @read="onCardRead"
                @qr="onQrRead"
                @camera="saveCamera"
              />
              <div v-if="!wantQr && !wantCard && !optionalScan" class="scanner-toggle">
                <button type="button" class="btn-sm" @click="optionalScan = true; scannerOn = true">掃建中學生證核對</button>
              </div>
              <div v-else class="scanner-toggle">
                <p v-if="!scannerOn && scanDesk.active" class="check-meta">已通知連線的手機：{{ scannerPrompt }}</p>
                <button type="button" class="btn-sm muted" @click="scannerOn = !scannerOn">
                  {{ scannerOn ? '關閉這台的相機' : '用這台的相機掃描' }}
                </button>
              </div>
            </div>

            <p v-if="!order.paid" class="pickup-warning" role="status">此訂單尚未付款</p>

            <button
              type="button"
              class="btn collect-button"
              :disabled="!canCollect || changingStatus || loading || loadError"
              @click="setDelivered(true)"
            >
              {{ collectLabel }}
            </button>

            <details v-if="auth.isAdmin" class="admin-override" :open="!!overrideReason">
              <summary>管理員：無法完成檢查時手動處理</summary>
              <label class="manual-reason">
                核對身分的方式與原因（會記錄在訂單）
                <input v-model="overrideReason" maxlength="500" placeholder="例如：忘了 QR Code，核對身分證">
              </label>
            </details>
          </div>

          <div v-else class="pickup-done" role="status">
            <p class="pickup-done-title">✓ 已領票</p>
            <p>{{ order.customerName || '（未填姓名）' }}・{{ itemsSummary }}；請交付紙本票券</p>
            <template v-if="scanDesk.active">
              <p>用手機掃下一位的 QR Code 或學生證，這台電腦會自動開啟</p>
            </template>
            <button v-else type="button" class="btn collect-button" @click="router.push({ name: 'admin-scan' })">
              掃描下一張
            </button>
          </div>

          <details v-if="order.delivered && auth.isAdmin" class="admin-override">
            <summary>管理員：重設為未領票</summary>
            <label class="manual-reason">
              重設原因（會記錄在訂單）
              <input v-model="overrideReason" maxlength="500" placeholder="例如：誤按領票">
            </label>
            <button
              type="button"
              class="btn-sm muted"
              :disabled="changingStatus || !overrideReason.trim() || loading || loadError"
              @click="setDelivered(false)"
            >
              標記未領票
            </button>
          </details>

          <p v-if="statusError" class="qr-check danger" role="alert">{{ statusError }}</p>
        </template>

        <div class="status-block">
          <div class="delivery-bar" :class="order.delivered ? 'delivered' : 'pending'">
            <span class="status-dot" />
            <span>領票狀態：{{ order.delivered ? '已領票' : '未領票' }}</span>
          </div>

          <div class="delivery-bar" :class="order.paid ? 'paid' : 'pending'">
            <span class="status-dot" />
            <span>付款狀態：{{ order.paid ? '已付款' : '未付款' }}</span>
            <div v-if="isAdminView && auth.isAdmin" class="delivery-actions">
              <button
                type="button"
                class="btn-sm muted"
                :disabled="changingStatus || !order.paid || loading || loadError"
                @click="setPaid(false)"
              >
                標記未付款
              </button>
              <button
                type="button"
                class="btn-sm"
                :disabled="changingStatus || order.paid || loading || loadError"
                @click="setPaid(true)"
              >
                標記已付款
              </button>
            </div>
          </div>
        </div>

        <p v-if="changingStatus" class="check-meta" role="status">正在確認並更新訂單…</p>
        <p v-if="isAdminView && order.deliveryUpdatedByName" class="check-meta">
          最後領票更新：{{ order.deliveryUpdatedByName }} · {{ formatDateTime(order.deliveryUpdatedAt) }}
        </p>
        <p v-if="isAdminView && order.notices" class="check-meta">
          已寄通知：繳費 {{ noticeCounts.payment }} 次・領票 {{ noticeCounts.pickup }} 次
        </p>
        <div v-if="isAdminView && auth.isSuperAdmin && !cancelBlockOf(order)" class="cancel-row">
          <button type="button" class="btn-outline cancel-action" :disabled="changingStatus || loading" @click="cancelOpen = true">
            取消訂單
          </button>
        </div>
      </section>

      <CancelOrderDialog v-if="isAdminView && auth.isSuperAdmin" v-model="cancelOpen" :orders="[order]" @cancelled="onCancelled" />

      <!-- ---------- QR ---------- -->
      <section class="panel">
        <h2>訂單 QR Code</h2>
        <p class="panel-copy">領票時請出示此 QR Code 給工作人員掃描</p>

        <div class="order-qr-card">
          <div class="qr-canvas-wrapper">
            <canvas
              ref="qrCanvas"
              class="order-qr"
              width="220"
              height="220"
              role="img"
              :aria-label="`訂單 ${order.id} 的領票 QR Code`"
            />
          </div>

          <p v-if="qrError" role="alert">{{ qrError }}</p>
          <button v-if="qrError" type="button" class="btn" @click="renderQr">
            重新產生 QR Code
          </button>
        </div>
      </section>

      <!-- ---------- buyer info ---------- -->
      <section class="panel">
        <h2>購票資訊</h2>

        <dl class="info-list">
          <div>
            <dt>訂單編號</dt>
            <dd class="mono">{{ order.id }}</dd>
          </div>
          <div>
            <dt>建立時間</dt>
            <dd class="num">{{ formatDateTime(order.createdAt) }}</dd>
          </div>
          <div v-if="order.customerName">
            <dt>購票人</dt>
            <dd>{{ order.customerName }}</dd>
          </div>
          <div v-if="order.customerEmail">
            <dt>Email</dt>
            <dd class="mono">{{ order.customerEmail }}</dd>
          </div>
          <div v-if="order.customerPhone">
            <dt>聯絡電話</dt>
            <dd class="mono">{{ order.customerPhone }}</dd>
          </div>
          <div v-if="order.complimentary">
            <dt>公關票</dt>
            <dd>{{ guestSourceText(order) }}</dd>
          </div>
          <div v-else-if="order.school">
            <dt>學校</dt>
            <dd>{{ order.school }}</dd>
          </div>
          <div v-if="order.streetSale">
            <dt>路宣登記人</dt>
            <dd>{{ order.promoterName || order.promoterEmail }}</dd>
          </div>
          <div v-if="order.class">
            <dt>班級</dt>
            <dd>{{ order.class }}</dd>
          </div>
          <div v-if="order.number">
            <dt>座號</dt>
            <dd>{{ order.number }}</dd>
          </div>
          <div v-if="order.office">
            <dt>辦公室</dt>
            <dd>{{ order.office }}</dd>
          </div>
        </dl>
      </section>

      <!-- ---------- tickets ---------- -->
      <section class="panel">
        <h2>票券明細</h2>

        <ul v-if="(order.items || []).length" class="product-stats">
          <li v-for="(item, index) in order.items || []" :key="item.id || index">
            <span>{{ item.name }}</span>
            <span class="item-meta">
              <span class="num">× {{ item.quantity }}</span>
              <strong class="num">
                NT$ {{ (Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString() }}
              </strong>
            </span>
          </li>
        </ul>
        <p v-else class="panel-copy">尚無票券資料</p>

        <div class="stats-row">
          <div class="stat">
            <div>應付總額</div>
            <div class="num accent">NT$ {{ Number(order.finalTotal ?? 0).toLocaleString() }}</div>
          </div>
          <div class="stat">
            <div>付款狀態</div>
            <div class="num">{{ order.paid ? '已付款' : '未付款' }}</div>
          </div>
          <div class="stat">
            <div>領票狀態</div>
            <div class="num">{{ order.delivered ? '已領票' : '未領票' }}</div>
          </div>
        </div>
      </section>

      <!-- ---------- event ---------- -->
      <section class="panel">
        <h2>活動資訊</h2>

        <dl class="info-list">
          <div>
            <dt>活動</dt>
            <dd>CK PARTY NIGHT</dd>
          </div>
          <div>
            <dt>日期</dt>
            <dd>{{ EVENT_DATE_LONG }}</dd>
          </div>
          <div>
            <dt>地點</dt>
            <dd>{{ EVENT_VENUE }}</dd>
          </div>
        </dl>

        <p class="panel-copy">
          請依主辦單位公告之方式及時間辦理領票。入場須使用紙本票券方可入場。
        </p>
      </section>

      <div class="order-actions">
        <button
          type="button"
          class="btn-outline"
          :disabled="downloadingReceipt"
          @click="downloadReceipt"
        >
          {{ downloadingReceipt ? '產生中...' : '下載收據' }}
        </button>

        <button type="button" class="btn" @click="printReceipt">
          列印收據
        </button>
      </div>

      <footer class="page-footer">
        <span>臺北市立建國高級中學班聯會</span>
        <span>CK PARTY NIGHT 2026 · COSMOS</span>
      </footer>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { EVENT_DATE_LONG, EVENT_VENUE, SITE_URL } from 'src/config/app'
import { guestSourceText } from 'src/data/guests'
import { fetchCancelledOrder, fetchOrder, updateOrderDelivery, updateOrderPayment } from 'src/services/orderService'
import { cleanStudentId, studentAccountEmail } from 'src/data/schools'
import { CANCEL_EMAIL_LABELS, CANCEL_REASONS, REFUND_STATUS_LABELS } from 'src/data/cancellations'
import { cancelBlockOf, noticeCountsOf } from 'src/utils/cancellations'
import CancelOrderDialog from 'src/components/CancelOrderDialog.vue'
import StudentCardScanner from 'src/components/StudentCardScanner.vue'
import { ID_CHECK_METHODS, ID_NOTE_MAX } from 'src/data/pickup'
import { fetchTicketTypes } from 'src/services/ticketTypeService'
import { parseTicketQr } from 'src/utils/ticketQr'
import { useAuthStore } from 'src/stores/auth'
import { useScanDeskStore } from 'src/stores/scanDesk'
import { useToastStore } from 'src/stores/toast'
import { formatDateTime } from 'src/utils/datetime'
import { getBuyerTypeLabel, getIdCheck, requiresStudentCard } from 'src/utils/buyerIdentity'
import { escapeHtml } from 'src/utils/text'
import { downloadElementAsPdf } from 'src/utils/pdf'
import { renderOrderQr } from 'src/utils/qrcode'

// Styles for the plain receipt used by both the print window and the PDF,
// all scoped to .receipt-doc
const RECEIPT_STYLES = `
  .receipt-doc,
  .receipt-doc * {
    box-sizing: border-box;
  }

  .receipt-doc {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    background: #fff;
    color: #111;
    font-family:
      Arial,
      "Noto Sans TC",
      sans-serif;
    line-height: 1.4;
  }

  /* the PDF copy sits on the site page, so undo Quasar's heading type */
  .receipt-doc h1,
  .receipt-doc h2 {
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: normal;
  }

  .receipt-doc .head {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 24px;
    border-bottom: 2px solid #111;
  }

  .receipt-doc .eyebrow {
    margin-bottom: 8px;
    font-size: 11px;
    letter-spacing: .16em;
    text-transform: uppercase;
  }

  .receipt-doc h1 {
    margin: 0;
    font-size: 28px;
  }

  .receipt-doc .order-id {
    text-align: right;
    font-size: 12px;
    color: #555;
  }

  .receipt-doc .section {
    padding: 24px 0;
    border-bottom: 1px solid #ccc;
  }

  .receipt-doc .section h2 {
    margin: 0 0 16px;
    font-size: 15px;
  }

  .receipt-doc .info {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px 16px;
    font-size: 13px;
  }

  .receipt-doc .info .label {
    color: #666;
  }

  .receipt-doc table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .receipt-doc th,
  .receipt-doc td {
    padding: 10px 0;
    border-bottom: 1px solid #ddd;
    text-align: left;
  }

  .receipt-doc th {
    font-size: 11px;
    color: #666;
  }

  .receipt-doc .center {
    text-align: center;
  }

  .receipt-doc .right {
    text-align: right;
  }

  .receipt-doc .sub {
    margin-top: 4px;
    color: #666;
    font-size: 11px;
  }

  .receipt-doc .total {
    display: flex;
    justify-content: space-between;
    padding-top: 18px;
    font-size: 18px;
    font-weight: 700;
  }

  .receipt-doc .note {
    margin-top: 24px;
    padding: 16px;
    background: #f5f5f5;
    font-size: 11px;
    line-height: 1.7;
  }

  .receipt-doc .footer {
    display: flex;
    justify-content: space-between;
    margin-top: 32px;
    padding-top: 14px;
    border-top: 1px solid #111;
    font-size: 10px;
    color: #666;
  }
`

const route = useRoute()
const router = useRouter()

const auth = useAuthStore()
const toast = useToastStore()
// receiving a phone's scans (/admin/scan/desk): 掃描下一張 goes back there
const scanDesk = useScanDeskStore()

const loading = ref(true)
const order = ref(null)
// the order when it is no longer in `orders` but in cancelledOrders
const cancelledOrder = ref(null)
const cancelOpen = ref(false)
const qrCanvas = ref(null)
const loadError = ref(false)
const qrError = ref('')
const changingStatus = ref(false)
const downloadingReceipt = ref(false)
const statusError = ref('')
const overrideReason = ref('')
let loadSequence = 0

const orderId = computed(() => String(route.params.id || ''))

// /admin/orders/:id is only reachable by managers (router guard)
const isAdminView = computed(() => route.name === 'admin-order-detail' && auth.isManager)

// Code from the scanned ticket QR (?c=...), compared with the order's secret
// ticketCode so a QR generated from a guessed order id is flagged (PARTY-19)
// What was scanned for this order: from /admin/scan (?c=, ?sid=), then the
// scanner on this page or a paired phone. Kept here rather than in the
// route, as the layout remakes the page on every route change
const scanned = ref({ c: String(route.query.c || ''), sid: String(route.query.sid || '') })
const scannedCode = computed(() => scanned.value.c)

// adds a scan; the address follows, so a reload keeps it
function addScan({ c = '', sid = '' }) {
  if (!c && !sid) return
  scanned.value = { c: c || scanned.value.c, sid: sid || scanned.value.sid }
  const query = { ...route.query, ...(scanned.value.c ? { c: scanned.value.c } : {}), ...(scanned.value.sid ? { sid: scanned.value.sid } : {}) }
  window.history.replaceState(window.history.state, '', router.resolve({ name: route.name, params: route.params, query }).href)
}

// 學號 read off the buyer's 建中 student card (?sid=..., from /admin/scan or
// the scanner on this page), compared with the order's school account
const studentCard = computed(() => {
  const id = cleanStudentId(scanned.value.sid)
  if (!isAdminView.value || !id || !order.value) return null
  return { id, match: String(order.value.customerEmail || '').toLowerCase() === studentAccountEmail(id) }
})
// A matching card counts at once: staff confirm its photo with the one tap
// that collects (the button says so), not with a separate tick
const cardReady = computed(() => !!studentCard.value?.match)

const qrCheck = computed(() => {
  if (!isAdminView.value || !order.value?.ticketCode) return null
  if (!scannedCode.value) return 'none'
  return scannedCode.value === order.value.ticketCode ? 'ok' : 'mismatch'
})
// 學生 / 社會人士 (staff only). 學生 buyers of types sold to students first
// show their student ID (any school's, or 酷課雲) before collecting
const buyerTypeLabel = computed(() => getBuyerTypeLabel(order.value))
const idCheck = computed(() => getIdCheck(order.value))
const needsIdCheck = computed(() => !!idCheck.value?.student)

// 限建中在學學生 types (一售票、早鳥票) need the 建中 card scanned. Until the
// ticket types load (or if they can't), a 建中 student's order counts
const ticketTypes = ref([])
const needsCard = computed(() => isAdminView.value && requiresStudentCard(order.value, ticketTypes.value))

// another way staff checked who collects, when the card can't be scanned
const exceptionOpen = ref(false)
const idMethod = ref('')
const idNote = ref('')
const idMethodLabel = computed(() => ID_CHECK_METHODS.find((method) => method.value === idMethod.value)?.short || '')
const exceptionReady = computed(() => !!idMethod.value && (idMethod.value !== 'other' || !!idNote.value.trim()))
const adminOverride = computed(() => auth.isAdmin && !!overrideReason.value.trim())

// 忘了 QR Code: an admin may let a matching student card stand in for it;
// the collect button says so
const qrByCard = computed(() => qrCheck.value !== 'ok' && auth.isAdmin && cardReady.value)
const codeDone = computed(() => qrCheck.value === 'ok' || qrByCard.value)
// who collects: the scanned card, another recorded check, or (types sold
// to students first) staff looking at a student ID, confirmed by the button
const idDone = computed(() => cardReady.value || (needsCard.value ? exceptionReady.value : true))

// the second row: shown when the order needs it, or when a card was
// scanned (an admin may use it for a forgotten QR code)
const idRow = computed(() => needsCard.value || needsIdCheck.value || (!!studentCard.value && qrCheck.value !== 'ok'))
const idRowTitle = computed(() => (needsCard.value || studentCard.value ? '建中學生證' : '學生證'))
const itemsSummary = computed(() => (order.value?.items || []).map((item) => `${item.name} × ${item.quantity}`).join('、'))

// both checks, in either order; an admin's reason covers both
// (updateOrderDelivery checks the same)
const canCollect = computed(() => {
  if (!order.value || order.value.delivered) return false
  return (codeDone.value || adminOverride.value) && (idDone.value || adminOverride.value)
})

// What the scanner on this page (or the paired phone) still waits for
const wantQr = computed(() => !codeDone.value)
const wantCard = computed(() => needsCard.value && !studentCard.value?.match && !exceptionReady.value)
// a 建中 student's order of a type sold to students first: scanning the
// card checks it for staff, though looking at it is enough
const optionalCard = computed(() => !needsCard.value && needsIdCheck.value && !!idCheck.value?.campus && !studentCard.value)
// staff chose to scan it (the camera does not open for it by itself)
const optionalScan = ref(false)
const idRowState = computed(() => {
  if (studentCard.value) return studentCard.value.match ? 'done' : 'bad'
  if (needsCard.value) return exceptionReady.value ? 'done' : 'wait'
  return 'wait'
})

// The one action, saying what tapping it confirms
const collectLabel = computed(() => {
  if (!canCollect.value) {
    if (!codeDone.value && !adminOverride.value) return qrCheck.value === 'mismatch' ? 'QR Code 不符，不能領票' : '等待掃描票券 QR Code'
    return '等待掃描學生證'
  }
  if (!codeDone.value || (!idDone.value && needsCard.value)) return '以管理員身分領票'
  if (cardReady.value && (needsCard.value || needsIdCheck.value || qrByCard.value)) {
    return qrByCard.value ? '照片是本人，以學生證代替 QR Code 領票' : '照片是本人，領票'
  }
  if (needsCard.value) return `已用${idMethodLabel.value}查驗，領票`
  if (needsIdCheck.value) return '已看過學生證，領票'
  return '領票'
})
const scannerWanted = computed(() =>
  isAdminView.value && !!order.value && !order.value.delivered && !loadError.value &&
  (wantQr.value || wantCard.value || optionalCard.value)
)
const buyerName = computed(() => order.value?.customerName || '購票人')
const scannerPrompt = computed(() => {
  if (wantQr.value && wantCard.value) return `請掃 ${buyerName.value} 的票券 QR Code 和學生證（順序不拘）`
  if (wantCard.value) return `請掃 ${buyerName.value} 的學生證`
  if (wantQr.value) return `請掃 ${buyerName.value} 的票券 QR Code`
  return `可以掃 ${buyerName.value} 的建中學生證自動核對，或看過證件後直接領票`
})
function waitingText(kind) {
  const where = scannerOn.value ? '用下方相機掃描' : scanDesk.active ? '用手機掃描' : '開啟相機掃描'
  return kind === 'qr' ? `等待掃描：請購票人出示 QR Code，${where}` : `等待掃描：請購票人出示建中學生證，${where}`
}

// The camera on this page starts by itself, except at a computer paired
// with a phone, which scans for it instead
const scannerOn = ref(!scanDesk.active)

// The scanner's camera choice is shared with /admin/scan (ScanPage.vue)
const CAMERA_KEY = 'cksc.scanCamera'
function savedCamera() {
  try {
    return localStorage.getItem(CAMERA_KEY) || ''
  } catch {
    return ''
  }
}
function saveCamera(deviceId) {
  try {
    localStorage.setItem(CAMERA_KEY, deviceId)
  } catch {
    // ignore
  }
}

function onCardRead({ studentId }) {
  addScan({ sid: studentId })
}

// Ticket QR codes point at the production site; also accept this origin
const origins = [...new Set([new URL(SITE_URL).origin, window.location.origin])]
// a QR code of another order, held up here: ask before leaving this one
const otherQr = ref(null)
let ignoredQr = ''
function onQrRead(text) {
  if (text === ignoredQr) return
  const ticket = parseTicketQr(text, origins)
  if (!ticket) {
    ignoredQr = text
    toast.show('這不是本系統的票券 QR Code')
    return
  }
  if (ticket.orderId === order.value?.id) {
    navigator.vibrate?.(60)
    addScan({ c: ticket.ticketCode })
    return
  }
  ignoredQr = text
  otherQr.value = { orderId: ticket.orderId, ticketCode: ticket.ticketCode }
}

// a scan of another order: from this page's camera, or the paired phone
const otherScan = computed(() => {
  if (scanDesk.pending) return { ...scanDesk.pending, from: 'phone' }
  return otherQr.value ? { ...otherQr.value, from: 'here' } : null
})
function openOtherScan() {
  const scan = otherScan.value
  if (!scan) return
  otherQr.value = null
  if (scan.from === 'phone') {
    scanDesk.open(scan)
    return
  }
  router.replace({ name: 'admin-order-detail', params: { id: scan.orderId }, query: scan.ticketCode ? { c: scan.ticketCode } : {} })
}
function dismissOtherScan() {
  otherQr.value = null
  scanDesk.dismissPending()
}

function closeException() {
  exceptionOpen.value = false
  idMethod.value = ''
  idNote.value = ''
}

// a paired phone asks for what this order still needs
watch(
  () => [scanDesk.active, scannerWanted.value, order.value?.id, wantQr.value, wantCard.value],
  () => {
    if (!scanDesk.active) return
    scanDesk.setNeed(scannerWanted.value
      ? { orderId: order.value.id, name: order.value.customerName, qr: wantQr.value, card: wantCard.value }
      : null)
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  if (scanDesk.active) scanDesk.setNeed(null)
})

// the paired phone scanned this order's QR code or card
watch(
  () => scanDesk.incoming,
  (entry) => {
    if (!entry || entry.orderId !== orderId.value) return
    scanDesk.takeIncoming()
    addScan({ c: entry.ticketCode, sid: entry.studentId })
  },
  { immediate: true }
)

const noticeCounts = computed(() => noticeCountsOf(order.value))

function onCancelled({ refundAmount }) {
  toast.show(refundAmount ? `已取消訂單，待退款 NT$ ${refundAmount.toLocaleString()}` : '已取消訂單')
  order.value = null
  loadOrder()
}

function resetChecks() {
  otherQr.value = null
  ignoredQr = ''
  closeException()
}

async function loadOrder() {
  const sequence = ++loadSequence
  const id = orderId.value
  loading.value = true
  loadError.value = false
  if (order.value?.id !== id) resetChecks()

  try {
    // which types need the student card (public settings; staff only)
    if (isAdminView.value && !ticketTypes.value.length) {
      fetchTicketTypes().then((types) => { ticketTypes.value = types }).catch((error) => console.error('Failed to load ticket types', error))
    }
    // staff can read any order, a buyer only their own (firestore.rules);
    // a cancelled one moved to cancelledOrders, where the same holds
    const result = await fetchOrder(id)
    const cancelled = result ? null : await fetchCancelledOrder(id)
    if (sequence !== loadSequence) return

    order.value = result ? { ...result, delivered: Boolean(result.delivered) } : null
    cancelledOrder.value = cancelled
  } catch (error) {
    console.error('Failed to load order:', error)
    if (sequence !== loadSequence) return
    loadError.value = true
  } finally {
    if (sequence === loadSequence) loading.value = false
  }

  if (sequence === loadSequence && order.value) await renderQr()
}

async function renderQr() {
  qrError.value = ''
  if (!order.value) return
  await nextTick()

  try {
    if (qrCanvas.value) await renderOrderQr(qrCanvas.value, order.value)
  } catch (error) {
    console.error(`QR Code 產生失敗：${order.value.id}`, error)
    qrError.value = '目前無法產生 QR Code，請重新產生。'
  }
}

async function setDelivered(delivered) {
  if (!isAdminView.value || !order.value || changingStatus.value || loading.value || loadError.value || order.value.delivered === delivered) {
    return
  }

  if (delivered ? !canCollect.value : (!auth.isAdmin || !overrideReason.value.trim())) return

  changingStatus.value = true
  statusError.value = ''
  const id = order.value.id
  try {
    const patch = await updateOrderDelivery(id, delivered, {
      ticketCode: scannedCode.value,
      expectedDelivered: order.value.delivered,
      overrideReason: auth.isAdmin ? overrideReason.value.trim() : '',
      ...(delivered && cardReady.value ? { studentId: studentCard.value.id, studentCardChecked: true } : {}),
      ...(delivered && qrByCard.value ? { skipQr: true } : {}),
      ...(delivered && needsCard.value && !cardReady.value && exceptionReady.value
        ? { idCheck: { method: idMethod.value, note: idNote.value.trim() } }
        : {})
    })
    if (orderId.value !== id) return
    order.value = { ...order.value, ...patch }
    overrideReason.value = ''
    // a later collection of the same order needs a new check
    resetChecks()
    toast.show(delivered ? '已標記為已領票' : '已標記為未領票')
  } catch (error) {
    console.error(error)
    if (orderId.value !== id) return
    statusError.value = error.message || '更新失敗，請重新確認訂單狀態。'
    await loadOrder()
  } finally {
    if (orderId.value === id) changingStatus.value = false
  }
}

async function setPaid(paid) {
  if (!auth.isAdmin || !order.value || changingStatus.value || loading.value || loadError.value || Boolean(order.value.paid) === paid) return
  changingStatus.value = true
  statusError.value = ''
  const id = order.value.id
  try {
    const patch = await updateOrderPayment(id, paid, Boolean(order.value.paid))
    if (orderId.value !== id) return
    order.value = { ...order.value, ...patch }
    toast.show(paid ? '已確認付款' : '已重設為未付款')
  } catch (error) {
    if (orderId.value !== id) return
    statusError.value = error.message || '更新失敗，請重新確認付款狀態。'
    await loadOrder()
  } finally {
    if (orderId.value === id) changingStatus.value = false
  }
}

function buildReceiptMarkup() {
  if (!order.value) {
    return ''
  }

  const currentOrder = order.value

  const items = (
    currentOrder.items || []
  )
    .map((item) => {
      const quantity =
        Number(item.quantity || 0)

      const price =
        Number(item.price || 0)

      const subtotal =
        quantity * price

      return `
        <tr>
          <td>
            ${escapeHtml(item.name)}
          </td>

          <td class="center">
            ${quantity}
          </td>

          <td class="right">
            NT$ ${subtotal.toLocaleString()}
          </td>
        </tr>
      `
    })
    .join('')

  const total = Number(currentOrder.finalTotal || 0)
  const buyerName = currentOrder.customerName || '—'
  const email = currentOrder.customerEmail || '—'
  const phone = currentOrder.customerPhone || '—'

  return `
  <div class="receipt-doc">
    <div class="head">
      <div>
        <div class="eyebrow">
          CK PARTY NIGHT
        </div>

        <h1>購票收據</h1>
      </div>

      <div class="order-id">
        <div>訂單編號</div>

        <strong>
          ${escapeHtml(
            currentOrder.id
          )}
        </strong>
      </div>
    </div>

    <div class="section">
      <h2>購票資訊</h2>

      <div class="info">
        <div class="label">購票人</div>
        <div>
          ${escapeHtml(buyerName)}
        </div>

        <div class="label">Email</div>
        <div>
          ${escapeHtml(email)}
        </div>

        <div class="label">聯絡電話</div>
        <div>
          ${escapeHtml(phone)}
        </div>

        <div class="label">學校</div>
        <div>
          ${escapeHtml(currentOrder.school || '—')}
        </div>
${
  currentOrder.class
    ? `
        <div class="label">班級 / 座號</div>
        <div>
          ${escapeHtml(currentOrder.class)} / ${escapeHtml(currentOrder.number || '—')}
        </div>
`
    : ''
}${
  currentOrder.office
    ? `
        <div class="label">辦公室</div>
        <div>
          ${escapeHtml(currentOrder.office)}
        </div>
`
    : ''
}
        <div class="label">建立時間</div>
        <div>
          ${escapeHtml(
            formatDateTime(
              currentOrder.createdAt
            )
          )}
        </div>

        <div class="label">領票狀態</div>
        <div>
          ${
            currentOrder.delivered
              ? '已領票'
              : '未領票'
          }
        </div>
      </div>
    </div>

    <div class="section">
      <h2>票券明細</h2>

      <table>
        <thead>
          <tr>
            <th>票券</th>
            <th class="center">
              數量
            </th>
            <th class="right">
              小計
            </th>
          </tr>
        </thead>

        <tbody>
          ${items}
        </tbody>
      </table>

      <div class="total">
        <span>應付總額</span>

        <span>
          NT$ ${total.toLocaleString()}
        </span>
      </div>
    </div>

    <div class="section">
      <h2>活動資訊</h2>

      <div class="info">
        <div class="label">活動</div>
        <div>CK PARTY NIGHT</div>

        <div class="label">日期</div>
        <div>${EVENT_DATE_LONG}</div>

        <div class="label">地點</div>
        <div>${EVENT_VENUE}</div>
      </div>
    </div>

    <div class="note">
      請依主辦單位公告之方式及時間辦理領票。
      入場時請依現場工作人員指示出示相關購票資訊。
    </div>

    <div class="footer">
      <span>
        臺北市立建國高級中學班聯會
      </span>

      <span>
        CK PARTY NIGHT 2026
      </span>
    </div>
  </div>
`
}

function buildReceiptHtml() {
  return `
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>CK PARTY NIGHT 購票收據</title>

<style>
  body {
    margin: 0;
    padding: 40px;
    background: #fff;
  }

  @media print {
    body {
      padding: 0;
    }
  }

${RECEIPT_STYLES}</style>
</head>

<body>
${buildReceiptMarkup()}</body>
</html>
  `
}

async function downloadReceipt() {
  if (!order.value || downloadingReceipt.value) {
    return
  }

  downloadingReceipt.value = true

  // html2pdf renders a copy of this off-page element; every rule in
  // RECEIPT_STYLES is scoped to .receipt-doc so nothing leaks onto the page
  const element = document.createElement('div')
  element.innerHTML = `<style>${RECEIPT_STYLES}</style>${buildReceiptMarkup()}`

  try {
    await downloadElementAsPdf(element, `CK-PARTY-NIGHT-${order.value.id}.pdf`)
  } catch (error) {
    console.error('PDF generation failed:', error)
    toast.show('收據 PDF 產生失敗，請稍後再試')
  } finally {
    downloadingReceipt.value = false
  }
}

function printReceipt() {
  if (!order.value) {
    return
  }

  const html = buildReceiptHtml()

  const printWindow =
    window.open(
      '',
      '_blank',
      'width=900,height=900'
    )

  if (!printWindow) {
    toast.show(
      '無法開啟列印視窗，請確認瀏覽器未封鎖彈出視窗'
    )

    return
  }

  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()

  printWindow.focus()

  setTimeout(() => {
    printWindow.print()
  }, 300)
}

function goBack() {
  if (window.history.length > 1) {
    router.back()
    return
  }

  // opened straight from a QR scan: go to the admin area, not the shop
  router.push(isAdminView.value ? { name: 'admin' } : '/')
}

watch(orderId, () => {
  order.value = null
  cancelledOrder.value = null
  statusError.value = ''
  overrideReason.value = ''
  changingStatus.value = false
  loadOrder()
}, { immediate: true })
</script>

<style scoped>
@import 'src/css/orderdetailpage.scss';
</style>