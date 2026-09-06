import { useMemo } from 'react';
import { Contract } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { ADDRESSES, ABIS } from '../config/contracts';

export function useContracts() {
  const { provider, signer } = useWallet();

  const contracts = useMemo(() => {
    if (!provider && !signer) {
      return {
        tokenContract: null,
        libraryContract: null,
        stakeContract: null,
        rentContract: null,
        paymentContract: null,
      };
    }

    const runner = signer || provider; // Use signer for transactions, provider for read-only calls

    return {
      tokenContract: new Contract(ADDRESSES.token, ABIS.token, runner),
      libraryContract: new Contract(ADDRESSES.library, ABIS.library, runner),
      stakeContract: new Contract(ADDRESSES.stake, ABIS.stake, runner),
      rentContract: new Contract(ADDRESSES.rent, ABIS.rent, runner),
      paymentContract: new Contract(ADDRESSES.payment, ABIS.payment, runner),
    };
  }, [provider, signer]);

  return contracts;
}
