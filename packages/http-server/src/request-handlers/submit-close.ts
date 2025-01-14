import type { SubmitCallback, RequestHandler, ExchangesApi } from '../types.js'
import type { ErrorDetail } from '@tbdex/http-client'
import type { MessageKind } from '@tbdex/protocol'

import { Message } from '@tbdex/protocol'

type SubmitCloseOpts = {
  callback: SubmitCallback<'close'>
  exchangesApi: ExchangesApi
}

export function submitClose(opts: SubmitCloseOpts): RequestHandler {
  const { callback } = opts

  return async function (req, res) {
    let message: Message<MessageKind>

    try {
      message = await Message.parse(req.body)
    } catch(e) {
      const errorResponse: ErrorDetail = { detail: e.message }
      return res.status(400).json({ errors: [errorResponse] })
    }

    if (!message.isClose()) {
      const errorResponse: ErrorDetail = { detail: 'expected request body to be a valid close' }
      return res.status(400).json({ errors: [errorResponse] })
    }

    // TODO: get most recent message added to exchange. use that to see if close is allowed (issue #1)
    // return 409 if close is not allowed given the current state of the exchange.

    // TODO: return 404 if exchange not found (issue #2)

    if (!callback) {
      return res.sendStatus(202)
    }

    try {
      // TODO: figure out what to do with callback result, if anything. (issue #12)
      const _result = await callback({ request: req, response: res }, message)
      return res.sendStatus(202)
    } catch(e) {
      // TODO: handle error lewl (issue #3)
    }
  }
}