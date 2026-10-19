import { zValidator } from '@hono/zod-validator'
import type { ZodType } from 'zod'
import { ApiError } from './errors'

// zValidator that fails with the API's error shape and the schema's message
export const valid = <Target extends 'json' | 'query', Schema extends ZodType>(target: Target, schema: Schema) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      const issue = result.error.issues[0]
      const custom = issue?.message && !/^(Invalid|Expected|Too|Unrecognized)/.test(issue.message)
      throw new ApiError('invalid-argument', custom ? issue.message : '資料格式錯誤', { field: issue?.path.join('.') })
    }
  })
