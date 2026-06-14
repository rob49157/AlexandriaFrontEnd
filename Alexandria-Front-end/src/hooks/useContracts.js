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
}
