/**
 * A figure of coins as the page says it: whole, with a comma at the thousands, the same in every locale. Apart
 * from the progress line and the ledger, which both say figures, so that neither needs the other.
 */
export const figure = (n: number) => Math.floor(n).toLocaleString('en-US');
