<<<<<<< Updated upstream
import { useMemo } from 'react'
import { Contract } from 'ethers'
import { useWallet } from '../context/WalletContext'
import { ADDRESSES, ABIS } from '../config/contracts'

export function useContracts() {
  const { signer } = useWallet()

  return useMemo(() => {
    if (!signer) return null
    return {
      token:   new Contract(ADDRESSES.token,   ABIS.token,   signer),
      library: new Contract(ADDRESSES.library, ABIS.library, signer),
      stake:   new Contract(ADDRESSES.stake,   ABIS.stake,   signer),
      rent:    new Contract(ADDRESSES.rent,    ABIS.rent,    signer),
      payment: new Contract(ADDRESSES.payment, ABIS.payment, signer),
    }
  }, [signer])
=======
import { useMemo } from 'react';
import { Contract } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { TOKEN_ABI, STAKE_ABI, LIBRARY_ABI } from '../config/contracts';

const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000001';
const STAKE_ADDRESS = import.meta.env.VITE_STAKE_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000002';
const LIBRARY_ADDRESS = import.meta.env.VITE_LIBRARY_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000003';

export function useContracts() {
  const { provider, signer } = useWallet();

  const contracts = useMemo(() => {
    if (!provider && !signer) return { tokenContract: null, stakeContract: null, libraryContract: null };

    const runner = signer || provider; // Use signer for writes, provider for reads

    return {
      tokenContract: new Contract(TOKEN_ADDRESS, TOKEN_ABI, runner),
      stakeContract: new Contract(STAKE_ADDRESS, STAKE_ABI, runner),
      libraryContract: new Contract(LIBRARY_ADDRESS, LIBRARY_ABI, runner),
    };
  }, [provider, signer]);

  return contracts;
>>>>>>> Stashed changes
}
