import type { ExchangesApi, GetCallback, GetExchangesFilter, RequestHandler } from '../types.js'

import { TbdexHttpClient } from '@tbdex/http-client'

type GetExchangesOpts = {
  callback: GetCallback<'exchanges'>
  exchangesApi: ExchangesApi
}

export function getExchanges(opts: GetExchangesOpts): RequestHandler {
  const { callback, exchangesApi } = opts
  return async function (request, response) {
    // TODO: verify authz token (#issue 9)
    const authzHeader = request.headers['authorization']
    if (!authzHeader) {
      return response.status(401).json({ errors: [{ detail: 'Authorization header required' }] })
    }

    const [_, requestToken] = authzHeader.split('Bearer ')

    if (!requestToken) {
      return response.status(401).json({ errors: [{ detail: 'Malformed Authorization header. Expected: Bearer TOKEN_HERE' }] })
    }

    let _requesterDid
    try {
      _requesterDid = await TbdexHttpClient.verify(requestToken)
    } catch(e) {
      return response.status(401).json({ errors: [{ detail: `Malformed Authorization header: ${e}` }] })
    }

    const queryParams = {}
    for (let param in request.query) {
      const val = request.query[param]
      queryParams[param] = Array.isArray(val) ? val : [val]
    }

    // check exchanges exist - what to do if some exist but others don't?
    const exchanges = await exchangesApi.getExchanges({ filter: queryParams as GetExchangesFilter || {} })

    if (callback) {
      // TODO: figure out what to do with callback result. should we pass through the exchanges we've fetched
      //       and allow the callback to modify what's returned? (issue #10)
      const _result = await callback({ request, response }, queryParams)
    }

    return response.status(200).json({ data: exchanges })
  }
}