'use strict';

/**
 * Check whether the currency symbol survives a GSM 7-bit encode, which is
 * what almost every SMS gateway uses for the 160 character segment.
 *
 * The default symbol is '$', which is in the GSM 7-bit basic set. This check
 * exists for the case where an operator switches to a symbol that is not.
 */

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

const symbol = process.env.BILLING_CURRENCY_SYMBOL_SMS || '$';

console.log(`checking BILLING_CURRENCY_SYMBOL_SMS=${symbol}`);
console.log('Symbol in the GSM 7-bit set:', GSM_BASIC.includes(symbol));
console.log('Character code point:', `U+${symbol.codePointAt(0).toString(16).toUpperCase()}`);
console.log('');
console.log(
  GSM_BASIC.includes(symbol)
    ? 'Conclusion: the symbol is GSM 7-bit safe.'
    : 'Conclusion: the symbol is NOT GSM 7-bit safe — messages will fall back to UCS-2.',
);
