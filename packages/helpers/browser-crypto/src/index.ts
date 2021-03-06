import {
  IJsonRpcResponseSuccess,
  IJsonRpcResponseError,
  IJsonRpcRequest,
  IEncryptionPayload,
} from "@walletconnect/types";

import {
  concatArrayBuffers,
  convertArrayBufferToHex,
  convertArrayBufferToUtf8,
  convertHexToArrayBuffer,
  convertUtf8ToArrayBuffer,
  removeHexPrefix,
  safeGetFromWindow,
} from "@walletconnect/utils";

const AES_ALGORITHM = "AES-CBC";
const AES_LENGTH = 256;
const HMAC_ALGORITHM = "SHA-256";

export async function exportKey(cryptoKey: CryptoKey): Promise<ArrayBuffer> {
  const browserCrypto = safeGetFromWindow<Crypto>("crypto");
  const buffer: ArrayBuffer = await browserCrypto.subtle.exportKey("raw", cryptoKey);
  return buffer;
}

export async function importKey(
  buffer: ArrayBuffer,
  type: string = AES_ALGORITHM,
): Promise<CryptoKey> {
  const aesParams: AesKeyAlgorithm = { length: AES_LENGTH, name: AES_ALGORITHM };
  const hmacParams: HmacImportParams = {
    hash: { name: HMAC_ALGORITHM },
    name: "HMAC",
  };
  const algoParams: AesKeyAlgorithm | HmacImportParams =
    type === AES_ALGORITHM ? aesParams : hmacParams;
  const usages: string[] = type === AES_ALGORITHM ? ["encrypt", "decrypt"] : ["sign", "verify"];
  const browserCrypto = safeGetFromWindow<Crypto>("crypto");
  const cryptoKey = await browserCrypto.subtle.importKey("raw", buffer, algoParams, true, usages);
  return cryptoKey;
}

export async function generateKey(length?: number): Promise<ArrayBuffer> {
  const _length = length || 256;
  const browserCrypto = safeGetFromWindow<Crypto>("crypto");
  const cryptoKey = await browserCrypto.subtle.generateKey(
    {
      length: _length,
      name: AES_ALGORITHM,
    },
    true,
    ["encrypt", "decrypt"],
  );
  const key: ArrayBuffer = await exportKey(cryptoKey);
  return key;
}

export async function createHmac(data: ArrayBuffer, key: ArrayBuffer): Promise<ArrayBuffer> {
  const cryptoKey: CryptoKey = await importKey(key, "HMAC");
  const browserCrypto = safeGetFromWindow<Crypto>("crypto");
  const signature = await browserCrypto.subtle.sign(
    {
      length: 256,
      name: "HMAC",
    },
    cryptoKey,
    data,
  );
  return signature;
}

export async function verifyHmac(payload: IEncryptionPayload, key: ArrayBuffer): Promise<boolean> {
  const cipherText: ArrayBuffer = convertHexToArrayBuffer(payload.data);
  const iv: ArrayBuffer = convertHexToArrayBuffer(payload.iv);
  const hmac: ArrayBuffer = convertHexToArrayBuffer(payload.hmac);
  const hmacHex: string = convertArrayBufferToHex(hmac, true);

  const unsigned: ArrayBuffer = concatArrayBuffers(cipherText, iv);
  const chmac: ArrayBuffer = await createHmac(unsigned, key);
  const chmacHex: string = convertArrayBufferToHex(chmac, true);

  if (removeHexPrefix(hmacHex) === removeHexPrefix(chmacHex)) {
    return true;
  }

  return false;
}

export async function aesCbcEncrypt(
  data: ArrayBuffer,
  key: ArrayBuffer,
  iv: ArrayBuffer,
): Promise<ArrayBuffer> {
  const cryptoKey: CryptoKey = await importKey(key, AES_ALGORITHM);
  const browserCrypto = safeGetFromWindow<Crypto>("crypto");
  const result: ArrayBuffer = await browserCrypto.subtle.encrypt(
    {
      iv,
      name: AES_ALGORITHM,
    },
    cryptoKey,
    data,
  );
  return result;
}

export async function aesCbcDecrypt(
  data: ArrayBuffer,
  key: ArrayBuffer,
  iv: ArrayBuffer,
): Promise<ArrayBuffer> {
  const cryptoKey: CryptoKey = await importKey(key, AES_ALGORITHM);
  const browserCrypto = safeGetFromWindow<Crypto>("crypto");
  const result: ArrayBuffer = await browserCrypto.subtle.decrypt(
    {
      iv,
      name: AES_ALGORITHM,
    },
    cryptoKey,
    data,
  );
  return result;
}

export async function encrypt(
  data: IJsonRpcRequest | IJsonRpcResponseSuccess | IJsonRpcResponseError,
  key: ArrayBuffer,
  providedIv?: ArrayBuffer,
): Promise<IEncryptionPayload> {
  if (!key) {
    throw new Error("Missing key: required for encryption");
  }

  const iv: ArrayBuffer = providedIv || (await generateKey(128));
  const ivHex: string = convertArrayBufferToHex(iv, true);

  const contentString: string = JSON.stringify(data);
  const content: ArrayBuffer = convertUtf8ToArrayBuffer(contentString);

  const cipherText: ArrayBuffer = await aesCbcEncrypt(content, key, iv);
  const cipherTextHex: string = convertArrayBufferToHex(cipherText, true);

  const unsigned: ArrayBuffer = concatArrayBuffers(cipherText, iv);
  const hmac: ArrayBuffer = await createHmac(unsigned, key);
  const hmacHex: string = convertArrayBufferToHex(hmac, true);

  return {
    data: cipherTextHex,
    hmac: hmacHex,
    iv: ivHex,
  };
}

export async function decrypt(
  payload: IEncryptionPayload,
  key: ArrayBuffer,
): Promise<IJsonRpcRequest | IJsonRpcResponseSuccess | IJsonRpcResponseError | null> {
  if (!key) {
    throw new Error("Missing key: required for decryption");
  }

  const verified: boolean = await verifyHmac(payload, key);
  if (!verified) {
    return null;
  }

  const cipherText: ArrayBuffer = convertHexToArrayBuffer(payload.data);
  const iv: ArrayBuffer = convertHexToArrayBuffer(payload.iv);
  const buffer: ArrayBuffer = await aesCbcDecrypt(cipherText, key, iv);
  const utf8: string = convertArrayBufferToUtf8(buffer);
  let data: IJsonRpcRequest;
  try {
    data = JSON.parse(utf8);
  } catch (error) {
    return null;
  }

  return data;
}
