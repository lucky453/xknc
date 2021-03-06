const { expect, assert } = require('chai')
const { utils } = require('ethers')

describe('xKNC', () => {
  const provider = waffle.provider
  const [wallet, user] = provider.getWallets()

  const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

  let xknc, knc, kyberProxy, kyberStaking, kyberDao

  before(async () => {
    const KyberStaking = await ethers.getContractFactory('MockKyberStaking')
    kyberStaking = await KyberStaking.deploy()
    await kyberStaking.deployed()

    const KyberProxy = await ethers.getContractFactory('MockKyberNetworkProxy')
    kyberProxy = await KyberProxy.deploy()
    await kyberProxy.deployed()

    const KNC = await ethers.getContractFactory('MockKNC')
    knc = await KNC.deploy()
    await knc.deployed()
    console.log('knc address', knc.address)

    const KyberDao = await ethers.getContractFactory('MockKyberDAO')
    kyberDao = await KyberDao.deploy()
    await kyberDao.deployed()

    const xKNC = await ethers.getContractFactory('xKNC')
    xknc = await xKNC.deploy(
      "Votes in stakers' interests",
      kyberStaking.address,
      kyberProxy.address,
      knc.address,
      kyberDao.address
    )
    await xknc.deployed()
    console.log('xKNC address:', xknc.address)

    await kyberProxy.setKncAddress(knc.address)
    await knc.transfer(kyberProxy.address, utils.parseEther('500'))

    await kyberStaking.setKncAddress(knc.address)
    await knc.transfer(kyberStaking.address, utils.parseEther('5'))

    const MockToken = await ethers.getContractFactory('MockToken')
    mockToken = await MockToken.deploy()
    await mockToken.deployed()

    const KyberFeeHandler = await ethers.getContractFactory(
      'MockKyberFeeHandler',
    )
    kyberFeeHandler = await KyberFeeHandler.deploy()
    await kyberFeeHandler.deployed()

    const TokenKyberFeeHandler = await ethers.getContractFactory(
      'MockTokenKyberFeeHandler',
    )
    tokenKyberFeeHandler = await TokenKyberFeeHandler.deploy(mockToken.address)
    await tokenKyberFeeHandler.deployed()

    const tx1 = { to: kyberFeeHandler.address, value: utils.parseEther('0.1') }
    await wallet.sendTransaction(tx1)
    await mockToken.transfer(tokenKyberFeeHandler.address, utils.parseEther('1'))
  })

  describe('xKNC: deployment', () => {
    it('should set the fee divisors', async () => {
      await xknc.setFeeDivisors('0', '500', '100')
      assert.isOk('Fee set')
    })

    it('should set a kyber fee handler address', async () => {
      await xknc.addKyberFeeHandler(kyberFeeHandler.address, ETH_ADDRESS)
      assert.isOk('Kyber fee handler address set')
    })

    it('should approve the staking contract to spend knc', async () => {
      await xknc.approveStakingContract(false)
      const approvedBal = await knc.allowance(
        xknc.address,
        kyberStaking.address,
      )
      assert.isAbove(approvedBal, 0, 'Approval succeeded')
    })

    it('should approve the network proxy contract to spend knc', async () => {
      await xknc.approveKyberProxyContract(knc.address, false)
      const approvedBal = await knc.allowance(xknc.address, kyberProxy.address)
      assert.isAbove(approvedBal, 0, 'Approval succeeded')
    })
  })

  describe('xKNC: minting with ETH', async () => {
    it('should issue xKNC tokens to the caller', async () => {
      await xknc.mint(0, { value: utils.parseEther('0.01') })
      const xkncBal = await xknc.balanceOf(wallet.address)

      assert.isAbove(xkncBal, 0, 'xKNC minted')
    })

    it('should result in staked KNC', async () => {
      const stakedBal = await xknc.getFundKncBalanceTwei()
      assert.isAbove(stakedBal, 0, 'KNC staked')
    })
  })

  describe('xKNC: minting with KNC', async () => {
    let stakedBalBefore
    it('should issue xKNC tokens to the caller', async () => {
      stakedBalBefore = await xknc.getFundKncBalanceTwei()
      const xkncBalBefore = await xknc.balanceOf(wallet.address)
      await knc.approve(xknc.address, utils.parseEther('10000'))

      await xknc.mintWithKnc(utils.parseEther('0.01'))
      const xkncBalAfter = await xknc.balanceOf(wallet.address)

      assert.isAbove(xkncBalAfter, xkncBalBefore, 'xKNC minted')
    })

    it('should result in staked KNC', async () => {
      const stakedBalAfter = await xknc.getFundKncBalanceTwei()
      assert.isAbove(stakedBalAfter, stakedBalBefore, 'KNC staked')
    })
  })

  describe('xKNC: burning', async () => {
    it('should send ETH to caller if burning for ETH', async () => {
      const totalSupply = await xknc.totalSupply()
      const toBurn = totalSupply.div(utils.bigNumberify(5))
      const ethBalBefore = await provider.getBalance(wallet.address)

      await xknc.burn(toBurn, false, 0)
      const ethBalAfter = await provider.getBalance(wallet.address)
      assert.isAbove(ethBalAfter, ethBalBefore)
    })

    it('should send KNC to caller if burning for KNC', async () => {
      const totalSupply = await xknc.totalSupply()
      const toBurn = totalSupply.div(utils.bigNumberify(5))
      const kncBalBefore = await knc.balanceOf(wallet.address)

      await xknc.burn(toBurn, true, 0)
      const kncBalAfter = await knc.balanceOf(wallet.address)
      assert.isAbove(kncBalAfter, kncBalBefore)
    })
  })

  describe('xKNC: DAO', async () => {
    it('should vote in a campaign', async () => {
      await xknc.vote(1, 1)
      assert.isOk('Campaign vote submitted')
    })

    it('should not be able to vote in a campaign if called from non-owner', async () => {
      await expect(xknc.connect(user).vote(1, 1)).to.be.reverted
    })

    it('should claim ETH reward and convert to KNC', async () => {
      const stakedBalBefore = await xknc.getFundKncBalanceTwei()
      await xknc.claimReward(1, [0], [100000], [0])
      const stakedBalAfter = await xknc.getFundKncBalanceTwei()
      assert.isAbove(stakedBalAfter, stakedBalBefore)
    })

    it('should not be able to claim if called from non-owner', async () => {
      await expect(xknc.connect(user).claimReward(1, [0], [10000], [0])).to.be
        .reverted
    })

    it('should be able to add a fee handler for an ERC20', async () => {
      await xknc.addKyberFeeHandler(
        tokenKyberFeeHandler.address,
        mockToken.address,
      )
      assert.isOk('Fee handler added')
    })

    it('should be able to approve the reward token on the kyber proxy', async () => {
      await xknc.approveKyberProxyContract(mockToken.address, false)
      assert.isOk('Proxy approved for reward token')
    })

    it('should be able to claim from the token fee handler contract', async () => {
      const stakedBalBefore = await xknc.getFundKncBalanceTwei()
      await xknc.claimReward(2, [1], [100000], [0])
      const stakedBalAfter = await xknc.getFundKncBalanceTwei()
      assert.isAbove(stakedBalAfter, stakedBalBefore)
    })
  })
})
