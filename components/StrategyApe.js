/******************************************************************************
**	@Author:				Thomas Bouder <Tbouder>
**	@Email:					Tbouder@protonmail.com
**	@Date:					Friday April 23rd 2021
**	@Filename:				StrategyYVBoost.js
******************************************************************************/

import	{useState, useEffect}		from	'react';
import	useCurrencies				from	'contexts/useCurrencies';
import	{toAddress, bigNumber}		from	'utils';
import	{ethers}					from	'ethers';
import	SectionRemove				from	'components/Strategies/SectionRemove'
import	SectionHead					from	'components/Strategies/SectionHead'
import	SectionFoot					from	'components/Strategies/SectionFoot'
import	Group, {GroupElement}		from	'components/Strategies/Group'
import	* as api					from	'utils/API';
import	methods						from	'utils/methodsSignatures';

async function	PrepareStrategyApe(parameters, address) {
	let		timestamp = undefined;
	const	normalTx = await api.retreiveTxFromEtherscan(address);
	const	erc20Tx = await api.retreiveErc20TxFromEtherscan(address);

	async function	computeFees() {
		const	cumulativeFees = (
			normalTx
			.filter(tx => (
				(
					toAddress(tx.from) === toAddress(address) &&
					toAddress(tx.to) === toAddress(parameters.contractAddress) &&
					(
						tx.input.startsWith(methods.YV_DEPOSIT) ||
						tx.input.startsWith(methods.YV_DEPOSIT_VOWID)
					)
				)
				||
				(
					toAddress(tx.from) === toAddress(address) &&
					toAddress(tx.to) === toAddress(parameters.contractAddress) &&
					tx.input.startsWith(methods.YV_WITHDRAW)
				)
				||
				(
					tx.input.startsWith(methods.STANDARD_APPROVE) &&
					(tx.input.toLowerCase()).includes((parameters.contractAddress.slice(2)).toLowerCase())
				)
			)).reduce((accumulator, tx) => {
				const	gasUsed = bigNumber.from(tx.gasUsed);
				const	gasPrice = bigNumber.from(tx.gasPrice);
				const	gasUsedPrice = gasUsed.mul(gasPrice);
				return bigNumber.from(accumulator).add(gasUsedPrice);
			}, bigNumber.from(0))
		);
		return (Number(ethers.utils.formatUnits(cumulativeFees, 18)));
	}

	async function	computeSeeds() {
		const	cumulativeSeeds = (
			erc20Tx
			.filter(tx => (
				(toAddress(tx.to) === toAddress(parameters.contractAddress))
				&&
				(tx.tokenSymbol === parameters.underlyingTokenSymbol)
			)).reduce((accumulator, tx) => {
				if (timestamp === undefined || timestamp > tx.timeStamp) {
					timestamp = tx.timeStamp;
				}
				return bigNumber.from(accumulator).add(tx.value);
			}, bigNumber.from(0))
		);
		return Number(ethers.utils.formatUnits(cumulativeSeeds, parameters.underlyingTokenDecimal || 18));
	}

	async function	computeCropsAlt() {
		const	cumulativeCrops = (
			erc20Tx
			.filter(tx => (
				(toAddress(tx.from) === toAddress('0x0000000000000000000000000000000000000000'))
				&&
				(toAddress(tx.to) === toAddress(address))
				&&
				(tx.tokenSymbol === `yv${parameters.underlyingTokenSymbol}`)
			)).reduce((accumulator, tx) => {
				return bigNumber.from(accumulator).add(tx.value);
			}, bigNumber.from(0))
		);
		return Number(ethers.utils.formatUnits(cumulativeCrops, parameters.underlyingTokenDecimal || 18));
	}

	async function	computeCrops() {
		const	provider = new ethers.providers.AlchemyProvider('homestead', process.env.ALCHEMY_KEY)
		const	ABI = ['function balanceOf(address) external view returns (uint256)']
		const	smartContract = new ethers.Contract(parameters.contractAddress, ABI, provider)
		const	balanceOf = await smartContract.balanceOf(address);
		return (Number(ethers.utils.formatUnits(balanceOf, parameters.underlyingTokenDecimal || 18)));
	}

	async function	computeHarvest() {
		const	cumulativeHarvest = (
			erc20Tx
			.filter(tx => (
				(toAddress(tx.from) === toAddress(parameters.contractAddress)) && (toAddress(tx.to) === toAddress(address))
				&&
				(tx.tokenSymbol === parameters.underlyingTokenSymbol)
			)).reduce((accumulator, tx) => {
				return bigNumber.from(accumulator).add(tx.value);
			}, bigNumber.from(0))
		);
		return Number(ethers.utils.formatUnits(cumulativeHarvest, parameters.underlyingTokenDecimal || 18));
	}


	const	fees = await computeFees();
	const	initialCrops = await computeCrops();
	const	initialSeeds = await computeSeeds();
	const	harvest = await computeHarvest();

	return {
		fees,
		initialSeeds,
		initialCrops,
		harvest,
		timestamp,
	}
}

function	StrategyApe({parameters, address, uuid, fees, initialSeeds, initialCrops, harvest, date}) {
	const	{newCurrencies, currencyNonce} = useCurrencies();

	const	[isHarvested, set_isHarvested] = useState(false);

	const	[APY, set_APY] = useState(0);
	const	[result, set_result] = useState(0);
	const	[underlyingEarned, set_underlyingEarned] = useState(0);
	const	[totalFeesEth] = useState(fees);

	const	[ethToEuro, set_ethToEuro] = useState(newCurrencies['eth']?.price || 0);
	const	[underlyingToEuro, set_underlyingToEuro] = useState(newCurrencies[parameters.underlyingTokenCgID]?.price || 0);
		
	async function	retrieveShareValue() {
		const	provider = new ethers.providers.AlchemyProvider('homestead', process.env.ALCHEMY_KEY)
		const	ABI = ['function pricePerShare() external view returns (uint256)']
		const	smartContract = new ethers.Contract(parameters.contractAddress, ABI, provider)
		const	pricePerShare = await smartContract.pricePerShare();
		const	share = initialCrops * (pricePerShare / 1e18)
		set_underlyingEarned(share)
	}

	useEffect(() => {
		if (harvest > 0 && initialCrops === 0) {
			set_isHarvested(true);
		}
	}, [harvest, initialCrops])

	useEffect(() => {
		set_ethToEuro(newCurrencies['eth']?.price || 0);
		set_underlyingToEuro(newCurrencies[parameters.underlyingTokenCgID]?.price || 0);
		retrieveShareValue();
	}, [currencyNonce]);

	useEffect(() => {
		if (harvest > 0 && initialCrops === 0) {
			set_result(((harvest - initialSeeds) * underlyingToEuro) - (totalFeesEth * ethToEuro));
		} else {
			set_result(
				((underlyingEarned - initialSeeds) * underlyingToEuro) -
				(totalFeesEth * ethToEuro)
			);
		}
	}, [ethToEuro, underlyingToEuro, underlyingEarned, totalFeesEth])

	useEffect(() => {
		const	vi = initialSeeds * underlyingToEuro;
		const	vf = result + vi;
		set_APY((vf - vi) / vi * 100)
	}, [ethToEuro, result])

	return (
		<div className={'flex flex-col col-span-1 rounded-lg shadow bg-dark-600 p-6 relative'}>
			<SectionRemove uuid={uuid} />
			<SectionHead
				title={parameters.title}
				href={parameters.href}
				address={address}
				date={date}
				APY={APY} />
			
			<div className={'space-y-8'}>
				<Group title={'Seeds'}>
					<GroupElement
						image={parameters.underlyingTokenIcon}
						label={parameters.underlyingTokenSymbol}
						address={parameters.underlyingTokenAddress}
						amount={parseFloat(initialSeeds.toFixed(10))}
						value={(initialSeeds * underlyingToEuro).toFixed(2)} />
				</Group>

				<Group title={'Crops'}>
					<GroupElement
						image={'/yGeneric.svg'}
						label={`yv${parameters.underlyingTokenSymbol}`}
						address={parameters.contractAddress}
						amount={parseFloat(initialCrops.toFixed(10))}
						value={(initialCrops * underlyingToEuro).toFixed(2)} />
				</Group>

				{isHarvested ?
					<>
						<Group title={'Yield'}>
							<GroupElement
								image={'/yGeneric.svg'}
								label={`yv${parameters.underlyingTokenSymbol}`}
								address={parameters.contractAddress}
								amount={parseFloat((underlyingEarned - initialSeeds).toFixed(10))}
								value={((underlyingEarned - initialSeeds) * underlyingToEuro).toFixed(2)} />
						</Group>
						<Group title={'Harvest'}>
							<GroupElement
								image={parameters.underlyingTokenIcon}
								label={parameters.underlyingTokenSymbol}
								address={parameters.underlyingTokenAddress}
								amount={parseFloat(harvest.toFixed(10))}
								value={(harvest * underlyingToEuro).toFixed(2)} />
							<GroupElement
								image={'⛽️'}
								label={'Fees'}
								amount={parseFloat(totalFeesEth.toFixed(10))}
								value={-(totalFeesEth * ethToEuro).toFixed(2)} />
						</Group>
					</>
				: 
					<Group title={'Yield'}>
						<GroupElement
							image={'/yGeneric.svg'}
							label={`yv${parameters.underlyingTokenSymbol}`}
							address={parameters.contractAddress}
							amount={parseFloat((underlyingEarned - initialSeeds).toFixed(10))}
							value={((underlyingEarned - initialSeeds) * underlyingToEuro).toFixed(2)} />
						<GroupElement
							image={'⛽️'}
							label={'Fees'}
							amount={parseFloat(totalFeesEth.toFixed(10))}
							value={-(totalFeesEth * ethToEuro).toFixed(2)} />
					</Group>
				}
			</div>

			<SectionFoot result={result} />
		</div>
	)
}

export {PrepareStrategyApe};
export default StrategyApe;