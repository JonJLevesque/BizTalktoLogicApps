/**
 * readBizTalkFile — encoding-aware file reader for BizTalk artifacts.
 *
 * BizTalk files use two different encodings depending on file type:
 *   .odx  — UTF-8 with BOM (Visual Studio default for C#-based XML)
 *   .btm  — UTF-16 LE with BOM (Visual Studio XML editor default)
 *   .btp  — UTF-16 LE with BOM
 *   .xsd  — UTF-8 or UTF-16 LE depending on how it was created
 *   BindingInfo.xml — UTF-8
 *
 * Node.js readFile('utf-8') silently mangles UTF-16 LE content, turning every
 * character into two bytes. This helper detects the BOM and decodes correctly.
 */

import { readFile } from 'node:fs/promises';

const UTF16_LE_BOM = [0xff, 0xfe];
const UTF8_BOM     = [0xef, 0xbb, 0xbf];

export async function readBizTalkFile(filePath: string): Promise<string> {
  const buf = await readFile(filePath);

  // UTF-16 LE BOM: FF FE
  if (buf[0] === UTF16_LE_BOM[0] && buf[1] === UTF16_LE_BOM[1]) {
    return new TextDecoder('utf-16le').decode(buf);
  }

  // UTF-8 BOM: EF BB BF — strip it, return rest as utf-8
  if (buf[0] === UTF8_BOM[0] && buf[1] === UTF8_BOM[1] && buf[2] === UTF8_BOM[2]) {
    return buf.subarray(3).toString('utf-8');
  }

  // No BOM — treat as UTF-8
  return buf.toString('utf-8');
}
