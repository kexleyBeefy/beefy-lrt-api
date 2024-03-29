import type { IPlatform, IPlatformConstructor, PlatformBalance } from './types.js';
import type { ChainId } from '../config/chains.js';
import { type Address, type GetBlockReturnType, getContract, type PublicClient } from 'viem';
import type { Vault } from '../utils/vaults.js';
import { BalancerPoolAbi } from '../abi/BalancerPoolAbi.js';
import { BalancerVaultAbi } from '../abi/BalancerVaultAbi.js';
import { defaultLogger } from '../utils/log.js';
import { getWantFromVault } from './helpers.js';

class BalancerPlatform implements IPlatform {
  readonly id = 'balancer';

  constructor(
    protected readonly chainId: ChainId,
    protected readonly publicClient: PublicClient,
    protected readonly block: GetBlockReturnType
  ) {}

  public async getBalances(vault: Vault, users: Address[]): Promise<PlatformBalance[]> {
    const callParams = { blockNumber: this.block.number };
    const { wantAddress: balancerPoolAddress, wantBalances } = await getWantFromVault(
      vault,
      users,
      this.block.number,
      this.publicClient
    );

    const balancerPool = getContract({
      client: this.publicClient,
      abi: BalancerPoolAbi,
      address: balancerPoolAddress,
    });

    const [balancerVaultAddress, balancerPoolId, balancerTotalSupply] = await Promise.all([
      balancerPool.read.getVault(callParams),
      balancerPool.read.getPoolId(callParams),
      balancerPool.read.getActualSupply(callParams),
    ]);
    defaultLogger.debug({ balancerVaultAddress, balancerPoolId, balancerTotalSupply });

    const balancerVault = getContract({
      client: this.publicClient,
      abi: BalancerVaultAbi,
      address: balancerVaultAddress,
    });

    const [balancerPoolTokens] = await Promise.all([
      balancerVault.read.getPoolTokens([balancerPoolId], callParams),
    ]);

    const [poolTokens, poolBalances] = balancerPoolTokens;
    const poolTokenBalances = poolTokens.reduce(
      (acc, token, i) => {
        if (token !== balancerPoolAddress) {
          acc.push({ token, balance: poolBalances[i]! });
        }
        return acc;
      },
      [] as { token: Address; balance: bigint }[]
    );
    defaultLogger.debug({ poolTokenBalances });

    return users.flatMap((user, i) => {
      const userWantBalance = wantBalances[i]!;
      return poolTokenBalances.map(({ token, balance }) => ({
        user,
        token,
        balance: (balance * userWantBalance) / balancerTotalSupply,
      }));
    });
  }
}

export const Balancer = BalancerPlatform satisfies IPlatformConstructor<BalancerPlatform>;