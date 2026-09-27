// Deploy-time settings, read from functions/.env (change them there, no code
// edit needed). See functions/README.md.
import { defineBoolean, defineInt } from 'firebase-functions/params'

// Reject callable requests without a valid App Check token. Turn on only after
// App Check (reCAPTCHA Enterprise) is set up and APP_CHECK_SITE_KEY is filled
// in src/config/app.js, otherwise every order is rejected.
export const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', { default: false })

// Warm createOrder instances kept running; raise to 2-3 around the sale
// opening to avoid cold starts, set back to 0 afterwards (it costs money).
export const CREATE_ORDER_MIN_INSTANCES = defineInt('CREATE_ORDER_MIN_INSTANCES', { default: 0 })

// Max orders per signed-in account per 10 minutes, 0 = off. Counted per
// account rather than per IP: the client IP header can be forged by the
// caller, and schools and mobile carriers put many buyers behind one IP.
export const ORDER_LIMIT_PER_ACCOUNT = defineInt('ORDER_LIMIT_PER_ACCOUNT', { default: 0 })

// SES sending rate of the AWS account, in recipients per second.
export const SES_RECIPIENTS_PER_SECOND = defineInt('SES_RECIPIENTS_PER_SECOND', { default: 14 })
