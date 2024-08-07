const { request, gql } = require('graphql-request');
const BigNumber = require('bignumber.js');
const sdk = require('@defillama/sdk');
const utils = require('../utils');
const { pulsar } = require('./clients');
const { queryPools, queryPrior } = require('./queries');
const { updateFarmsRewardsApr, updatePoolsApr } = require('./offchain-service');
const {
    getPositionsInEternalFarming,
    getPreviousBlockNumber,
    getTokenInfoByAddress,
    getEternalFarmingInfo,
    getPositionsOfPool,
    getPositionsById,
    getAmounts,
} = require('./utils');
//     console.log('Updating Farms APR');
//     const eternalFarmings = await getEternalFarmingInfo();

//     const eternalObj = {
//       farmPools: {},
//       farms: {},
//       updatedAt: 0,
//     };

//     for (const farming of eternalFarmings) {
//       const tokenIds = await getPositionsInEternalFarming(farming.id);
//       const token0 = (await getTokenInfoByAddress(farming.rewardToken))[0];
//       const token1 = (await getTokenInfoByAddress(farming.bonusRewardToken))[0];
//       let totalNativeAmount = 0.0;
//       const positions = await getPositionsById(tokenIds);
//       for (const position of positions) {
//         const { amount0, amount1 } = getAmounts(
//           new BigNumber(position.liquidity),
//           new BigNumber(position.tickLower.tickIdx),
//           new BigNumber(position.tickUpper.tickIdx),
//           new BigNumber(position.pool.tick),
//         );
//         totalNativeAmount += (amount0 * new BigNumber(position.pool.token0.derivedMatic)) / new BigNumber(10).pow(position.pool.token0.decimals);
//         totalNativeAmount += (amount1 * new BigNumber(position.pool.token1.derivedMatic)) / new BigNumber(10).pow(position.pool.token1.decimals);
//       }

//       const token0RewardRate = new BigNumber(farming.rewardRate);
//       const token0Matic = new BigNumber(token0.derivedMatic);
//       const token0Decimals = new BigNumber(10).pow(token0.decimals);
//       const reward0PerSecond = token0RewardRate.times(token0Matic).dividedBy(token0Decimals);
//       let totalReward = reward0PerSecond;
//       let reward1PerSecond = 0;
//       if (token1?.derivedMatic) {
//         const token1RewardRate = new BigNumber(farming.bonusRewardRate);
//         const token1Matic = new BigNumber(token1.derivedMatic);
//         const token1Decimals = new BigNumber(10).pow(token1.decimals);
//         reward1PerSecond = token1RewardRate.times(token1Matic).dividedBy(token1Decimals);
//         totalReward = totalReward.plus(reward1PerSecond);
//       }

//       let apr = new BigNumber(0);
//       let rewardTokenApr = new BigNumber(0);
//       let bonusTokenApr = new BigNumber(0);
//       if (totalNativeAmount > 0) {
//         apr = totalReward.dividedBy(new BigNumber(totalNativeAmount)).times(86400 * 365 * 100);
//         rewardTokenApr = reward0PerSecond.dividedBy(new BigNumber(totalNativeAmount)).times(86400 * 365 * 100);
//         bonusTokenApr = reward1PerSecond !== 0 ? reward1PerSecond.dividedBy(new BigNumber(totalNativeAmount)).times(86400 * 365 * 100) : new BigNumber(0);
//       }
//       eternalObj.farms[farming.id] = apr.toString();
//       eternalObj.farmPools[farming.pool] = {
//         farmindId: farming.id,
//         lastApr: apr.toString(),
//         rewardTokenApr: rewardTokenApr.toString(),
//         rewardToken: farming.rewardToken,
//         bonusTokenApr: bonusTokenApr.toString(),
//         bonusToken: farming.bonusRewardToken,
//       };
//     }

//     eternalObj.updatedAt = (Date.now() / 1000).toFixed(0);
//     return eternalObj;
//   };

const topLvl = async (chainString, timestamp, url) => {
    const balanceCalls = [];
    const prevBlockNumber = await getPreviousBlockNumber()

    let data = (await request(url, queryPools)).pools
    const dataPrior = (await request(url, queryPrior.replace('<PREV_BLOCK_NUMBER>', prevBlockNumber))).pools;

    for (const pool of data) {
        balanceCalls.push({
            target: pool.token0.id,
            params: pool.id,
        });
        balanceCalls.push({
            target: pool.token1.id,
            params: pool.id,
        });
    }

    const tokenBalances = await sdk.api.abi.multiCall({
        abi: 'erc20:balanceOf',
        calls: balanceCalls,
        chain: chainString,
        permitFailure: true,
    });

    data = data.map((p) => {
        const x = tokenBalances.output.filter((i) => i.input.params[0] === p.id);
        return {
            ...p,
            reserve0: (parseFloat(x.find((i) => i.input.target === p.token0.id)?.output || 0) / Math.pow(10, p.token0.decimals)),
            reserve1: (parseFloat(x.find((i) => i.input.target === p.token1.id)?.output || 0) / Math.pow(10, p.token1.decimals)),
        };
    });

    data = await utils.tvl(data, chainString);

    const poolsFees = {};
    const poolsCurrentTvl = {};

    for (const pool of data) {
        const currentFeesInToken0 = new BigNumber(pool.feesToken0).plus(new BigNumber(pool.feesToken1).times(new BigNumber(pool.token0Price)));
        const priorData = dataPrior.find(dp => dp.id === pool.id);
        const priorFeesInToken0 = priorData ? new BigNumber(priorData.feesToken0).plus(new BigNumber(priorData.feesToken1).times(new BigNumber(priorData.token0Price))) : new BigNumber(0);
        const feesIn24Hours = currentFeesInToken0.minus(priorFeesInToken0);

        poolsFees[pool.id] = feesIn24Hours;
        poolsCurrentTvl[pool.id] = new BigNumber(0);
        const positionsJson = await getPositionsOfPool(pool.id);
        for (const position of positionsJson) {
            const currentTick = new BigNumber(pool.tick);
            const { amount0, amount1 } = getAmounts(
                new BigNumber(position.liquidity),
                new BigNumber(position.tickLower.tickIdx),
                new BigNumber(position.tickUpper.tickIdx),
                currentTick,
            );
            const adjustedAmount0 = amount0 / Math.pow(10, position.token0.decimals);
            const adjustedAmount1 = amount1 / Math.pow(10, position.token1.decimals);
            poolsCurrentTvl[pool.id] += adjustedAmount0 + (adjustedAmount1 * parseFloat(pool.token0Price));
        }
    }

    const poolsFarmApr = await updateFarmsRewardsApr();
    const poolsAPRObj = await updatePoolsApr();

    const poolsAPR = {};
    const poolsRewardTokens = {}; // Add this to store reward tokens for each pool

    const poolsBaseAPR = poolsAPRObj;

    for (const pool of data) {
        const apr = poolsBaseAPR[pool.id] ? new BigNumber(poolsBaseAPR[pool.id]) : new BigNumber(0);
        poolsAPR[pool.id] = apr;
    }

    data = data.map((p) => {
        const tvl = p.poolDayData[0]?.tvlUSD || 0;
        if (tvl > 30000) {
            const baseAPR = poolsAPR[p.id] ? poolsAPR[p.id].toNumber() : 0;
            const rewardsAPR = poolsFarmApr.pools[p.id]?.apr.toNumber() || 0; // Set to 0 if undefined


            // console.log('apr', baseAPR);
            // console.log('rewards', rewardsAPR);

            return {
                pool: p.id,
                chain: utils.formatChain(chainString),
                project: 'stellaswap-v3',
                symbol: `${p.token0.symbol}-${p.token1.symbol}`,
                tvlUsd: parseFloat(tvl),
                apyBase: baseAPR,
                apyReward: rewardsAPR,
                underlyingTokens: [p.token0.id, p.token1.id],
                url: `https://app.stellaswap.com/pulsar/add/${p.token0.id}/${p.token1.id}`,
            };
        }
    });

    // console.log('xxx', data)

    // Filter out pools with invalid or missing fields
    data = data.filter(p => p.pool && p.chain && p.project && p.symbol && p.underlyingTokens.length && p.url);

    return data;
};

const main = async (timestamp = null) => {
    const data = await Promise.all([topLvl('moonbeam', timestamp, pulsar)]);
    return data.flat().filter((p) => utils.keepFinite(p));
};

module.exports = {
    timetravel: false,
    apy: main,
    url: 'https://stellaswap.com/',
};
