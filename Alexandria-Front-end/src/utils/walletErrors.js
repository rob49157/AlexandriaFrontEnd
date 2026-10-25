// Wallet errors arrive wrapped by ethers, so the provider's own code sits on
// err.error / err.info.error rather than err.code.

/** Did the person decline in their wallet (EIP-1193 code 4001)? */
export function isUserRejection(err) {
  const inner = err?.info?.error ?? err?.error ?? err
  return err?.code === 'ACTION_REJECTED' || inner?.code === 4001 || err?.code === 4001
}
