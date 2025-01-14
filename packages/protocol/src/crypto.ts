import type {
  PrivateKeyJwk as Web5PrivateKeyJwk,
  CryptoAlgorithm,
  Web5Crypto,
  JwsHeaderParams
} from '@web5/crypto'

import { sha256 } from '@noble/hashes/sha256'
import { Convert } from '@web5/common'
import { EcdsaAlgorithm, EdDsaAlgorithm, Jose } from '@web5/crypto'
import { deferenceDidUrl, isVerificationMethod } from './did-resolver.js'

import canonicalize from 'canonicalize'

/**
 * Options passed to {@link Crypto.sign}
 * @beta
 */
export type SignOptions = {
  /** Indicates whether the payload is detached from the JWS. If `true`, the payload is not included in the resulting JWS. */
  detached: boolean,
  /** The payload to be signed. */
  payload: Uint8Array,
  /** The private key in JWK (JSON Web Key) format used for signing. */
  privateKeyJwk: Web5PrivateKeyJwk,
  /** A unique identifier for the key used to sign in the form of a DID URL. */
  kid: string
}

/**
 * Options passed to {@link Crypto.verify}
 * @beta
 */
export type VerifyOptions = {
  /** The payload that was signed. required only if the signature is a detached JWS */
  detachedPayload?: Uint8Array,
  signature: string
}

/**
 * Used as value for each supported named curved listed in {@link Crypto.algorithms}
 * @beta
 */
type SignerValue<T extends Web5Crypto.Algorithm> = {
  signer: CryptoAlgorithm,
  options?: T,
  alg: JwsHeader['alg'],
  crv: JsonWebKey['crv']
}

const secp256k1Signer: SignerValue<Web5Crypto.EcdsaOptions> = {
  signer  : new EcdsaAlgorithm(),
  options : { name: 'ECDSA', hash: 'SHA-256' },
  alg     : 'ES256K',
  crv     : 'secp256k1'
}

const ed25519Signer: SignerValue<Web5Crypto.EdDsaOptions> = {
  signer  : new EdDsaAlgorithm(),
  options : { name: 'EdDSA' },
  alg     : 'EdDSA',
  crv     : 'Ed25519'
}

/**
 * Cryptographic utility functions, such as hashing, signing, and verifying
 * @beta
 */
export class Crypto {
  /** supported cryptographic algorithms. keys are `${alg}:${crv}`. */
  static algorithms: { [alg: string]: SignerValue<Web5Crypto.EcdsaOptions | Web5Crypto.EdDsaOptions> } = {
    'ES256K:'          : secp256k1Signer,
    'ES256K:secp256k1' : secp256k1Signer,
    ':secp256k1'       : secp256k1Signer,
    'EdDSA:Ed25519'    : ed25519Signer
  }

  /**
   * Computes a digest of the payload by:
   * * JSON serializing the payload as per [RFC-8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
   * * sha256 hashing the serialized payload
   *
   * @returns The SHA-256 hash of the canonicalized payload, represented as a byte array.
   */
  static digest(payload: any) {
    // @ts-ignore
    const canonicalized = canonicalize(payload)
    const canonicalizedBytes = Convert.string(canonicalized).toUint8Array()

    return sha256(canonicalizedBytes)
  }

  /**
   * Signs the provided payload and produces a compact JSON Web Signature (JWS).
   *
   * @param opts - The options required for signing.
   * @returns A promise that resolves to the generated compact JWS.
   * @throws Will throw an error if the specified algorithm is not supported.
   */
  static async sign(opts: SignOptions) {
    const { privateKeyJwk, kid, payload, detached } = opts

    const algorithmName = privateKeyJwk['alg'] || ''
    const namedCurve = privateKeyJwk['crv'] || ''
    const algorithmId = `${algorithmName}:${namedCurve}`

    const algorithm = this.algorithms[algorithmId]
    if (!algorithm) {
      throw new Error(`${algorithmId} not supported`)
    }

    const jwsHeader: JwsHeader = { alg: algorithm.alg, kid }
    const base64UrlEncodedJwsHeader = Convert.object(jwsHeader).toBase64Url()
    const base64urlEncodedJwsPayload = Convert.uint8Array(payload).toBase64Url()

    const key = await Jose.jwkToCryptoKey({ key: privateKeyJwk as Web5PrivateKeyJwk })

    const toSign = `${base64UrlEncodedJwsHeader}.${base64urlEncodedJwsPayload}`
    const toSignBytes = Convert.string(toSign).toUint8Array()

    const signatureBytes = await algorithm.signer.sign({ key, data: toSignBytes, algorithm: algorithm.options })
    const base64UrlEncodedSignature = Convert.uint8Array(signatureBytes).toBase64Url()

    if (detached) {
      // compact JWS with detached content: https://datatracker.ietf.org/doc/html/rfc7515#appendix-F
      return `${base64UrlEncodedJwsHeader}..${base64UrlEncodedSignature}`
    } else {
      return `${base64UrlEncodedJwsHeader}.${base64urlEncodedJwsPayload}.${base64UrlEncodedSignature}`
    }
  }

  /**
   * Verifies the integrity of a message or resource's signature.
   *
   * @param opts - The options required for verification.
   * @returns A promise that resolves to the DID of the signer if verification is successful.
   * @throws Various errors related to invalid input or failed verification.
   */
  static async verify(opts: VerifyOptions): Promise<string> {
    const { signature, detachedPayload } = opts

    if (!signature) {
      throw new Error('Signature verification failed: Expected signature property to exist')
    }

    const splitJws = signature.split('.')
    if (splitJws.length !== 3) {
      throw new Error('Signature verification failed: Expected valid JWS with detached content')
    }

    let [base64UrlEncodedJwsHeader, base64urlEncodedJwsPayload, base64UrlEncodedSignature] = splitJws

    if (detachedPayload) {
      if (base64urlEncodedJwsPayload.length !== 0) { // ensure that JWS payload is empty
        throw new Error('Signature verification failed: Expected valid JWS with detached content')
      }
      base64urlEncodedJwsPayload = Convert.uint8Array(detachedPayload).toBase64Url()
    }

    const jwsHeader = Convert.base64Url(base64UrlEncodedJwsHeader).toObject() as JwsHeaderParams
    if (!jwsHeader.alg || !jwsHeader.kid) { // ensure that JWS header has required properties
      throw new Error('Signature verification failed: Expected JWS header to contain alg and kid')
    }

    const verificationMethod = await deferenceDidUrl(jwsHeader.kid as string)
    if (!isVerificationMethod(verificationMethod)) { // ensure that appropriate verification method was found
      throw new Error('Signature verification failed: Expected kid in JWS header to dereference to a DID Document Verification Method')
    }

    // will be used to verify signature
    const { publicKeyJwk } = verificationMethod
    if (!publicKeyJwk) { // ensure that Verification Method includes public key as a JWK.
      throw new Error('Signature verification failed: Expected kid in JWS header to dereference to a DID Document Verification Method with publicKeyJwk')
    }

    const signedData = `${base64UrlEncodedJwsHeader}.${base64urlEncodedJwsPayload}`
    const signedDataBytes = Convert.string(signedData).toUint8Array()

    const signatureBytes = Convert.base64Url(base64UrlEncodedSignature).toUint8Array()

    const algorithmId = `${jwsHeader['alg']}:${publicKeyJwk['crv']}`
    const { signer, options } = Crypto.algorithms[algorithmId]

    // TODO: remove this monkeypatch once 'ext' is no longer a required property within a jwk passed to `jwkToCryptoKey`
    const monkeyPatchPublicKeyJwk = {
      ...publicKeyJwk,
      ext     : 'true' as const,
      key_ops : ['verify']
    }

    const key = await Jose.jwkToCryptoKey({ key: monkeyPatchPublicKeyJwk })
    const isLegit = await signer.verify({ algorithm: options, key, data: signedDataBytes, signature: signatureBytes })

    if (!isLegit) {
      throw new Error('Signature verification failed: Integrity mismatch')
    }

    const [did] = (jwsHeader as JwsHeaderParams).kid.split('#')
    return did
  }
}

/**
 * monkey patch of JwsHeaderParams to include `EdDSA` as a valid alg
 * **NOTE**: Remove this once upstream `@web5/crypto` package is fixed
 * @internal
 */
type JwsHeader = Omit<JwsHeaderParams, 'alg'> & { alg: JwsHeaderParams['alg'] | 'EdDSA' }