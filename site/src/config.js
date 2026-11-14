// Bounty Board v2 — frontend configuration.
// All displayed values come from FINALIZED get_* readbacks of this contract.
export const APP_CONFIG = {
  REMEDIATED_DEPLOYMENT: false, // Revised address remains read-only until full live acceptance.
  RPC_URL: 'https://studio.genlayer.com/api',
  CHAIN_ID: 61999,
  NETWORK_NAME: 'Stable Studionet',
  CONTRACT_ADDRESS: '0x04109e0EA19e022Abdeb51BA907AF468aCEe1Da1',
  EXPLORER_ADDRESS: 'https://explorer-studio.genlayer.com/address/0x04109e0EA19e022Abdeb51BA907AF468aCEe1Da1',
  EXPLORER_TX: 'https://explorer-studio.genlayer.com/tx/',
  REPO_SLUG: 'xiaoyu7799/bounty-board-v2-genlayer',
  REPO_URL: 'https://github.com/xiaoyu7799/bounty-board-v2-genlayer',
  // 1 unit = 0.001 GEN = 10**15 wei. Amounts on chain are units; the
  // ledger (withdrawable / totals) is wei.
  WEI_PER_UNIT: 10n ** 15n,
  GEN: 10n ** 18n,
};
