const assert = require("assert");
const anchor = require("@project-serum/anchor");
const { SystemProgram } = anchor.web3;
const web3 = require("@solana/web3.js");
const spl_token = require("@solana/spl-token");

describe("grand-bazaar 2 person 2 token unit test", () => {
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.GrandBazaar;

  let mintA = null;
  let mintB = null;
  let initializerTokenAccountA = null;
  let initializerTokenAccountB = null;
  let takerTokenAccountA = null;
  let takerTokenAccountB = null;
  let vault_account_pda = null;
  let vault_account_bump = null;
  let vault_authority_pda = null;

  const takerAmount = 1000;
  const initializerAmount = 500;

  const escrowAccount = anchor.web3.Keypair.generate();
  const payer = anchor.web3.Keypair.generate();
  const mintAuthority = anchor.web3.Keypair.generate();
  const initializerMainAccount = anchor.web3.Keypair.generate();
  const takerMainAccount = anchor.web3.Keypair.generate();

  it("initialize escrow state", async () => {
    //Airdrop tokens to a payer
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(payer.publicKey, 10000000000),
      "confirmed"
    );

    //Fund main accounts
    await provider.send(
      (() => {
        const tx = new web3.Transaction();
        tx.add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: initializerMainAccount.publicKey,
            lamports: 1000000000,
          }),
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: takerMainAccount.publicKey,
            lamports: 1000000000,
          })
        );
        return tx;
      })(),
      [payer]
    );

    mintA = await spl_token.Token.createMint(
      provider.connection,
      payer,
      mintAuthority.publicKey,
      null,
      0,
      spl_token.TOKEN_PROGRAM_ID
    );

    mintB = await spl_token.Token.createMint(
      provider.connection,
      payer,
      mintAuthority.publicKey,
      null,
      0,
      spl_token.TOKEN_PROGRAM_ID
    );

    initializerTokenAccountA = await mintA.createAccount(
      initializerMainAccount.publicKey
    );
    takerTokenAccountA = await mintA.createAccount(takerMainAccount.publicKey);

    initializerTokenAccountB = await mintB.createAccount(
      initializerMainAccount.publicKey
    );
    takerTokenAccountB = await mintB.createAccount(takerMainAccount.publicKey);

    await mintA.mintTo(
      initializerTokenAccountA,
      mintAuthority.publicKey,
      [mintAuthority],
      initializerAmount
    );

    await mintB.mintTo(
      takerTokenAccountB,
      mintAuthority.publicKey,
      [mintAuthority],
      takerAmount
    );

    let _initializerTokenAccountA = await mintA.getAccountInfo(
      initializerTokenAccountA
    );
    let _takerTokenAccountB = await mintB.getAccountInfo(takerTokenAccountB);

    assert.ok(_initializerTokenAccountA.amount.toNumber() == initializerAmount);
    assert.ok(_takerTokenAccountB.amount.toNumber() == takerAmount);

    //NTS: Tests summary:
    //    Setup
    //    (i) create provider (network) and identify program (as always)
    //    (ii) create holders mint accounts, token accounts and vault accounts
    //    (iii) generate keypairs for escrowAccount, payer, mintAuthority
    //        initializerMainAccount and takerMainAccount
    //    First Test - initialize escrow state & mint starting tokens
    //    (i) mint tokenA and tokenB
    //    (ii) create token accounts for tokenA & token B for initializer & taker
    //    (iii) mint token A to initializer and token B to taker
    //        QS: why separate step than (i)? A: mintTo() vs. createMint() docs
    //    (iv) check if initializer has right # token A and same for taker/Token B
  });

  it("Initialize escrow (instruction)", async () => {
    const [
      _vault_account_pda,
      _vault_account_bump,
    ] = await web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("token-seed"))],
      program.programId
    );

    vault_account_pda = _vault_account_pda;
    vault_account_bump = _vault_account_bump;

    const [
      _vault_authority_pda,
      _vault_authority_bump,
    ] = await web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("escrow"))],
      program.programId
    );

    vault_authority_pda = _vault_authority_pda;

    await program.rpc.initializeEscrow(
      vault_account_bump,
      new anchor.BN(initializerAmount),
      new anchor.BN(takerAmount),
      {
        accounts: {
          initializer: initializerMainAccount.publicKey,
          vaultAccount: vault_account_pda,
          mint: mintA.publicKey,
          initializerDepositTokenAccount: initializerTokenAccountA,
          initializerReceiveTokenAccount: initializerTokenAccountB,
          escrowAccount: escrowAccount.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          tokenProgram: spl_token.TOKEN_PROGRAM_ID,
        },
        instructions: [
          await program.account.escrowAccount.createInstruction(escrowAccount),
          //QS: what is this instruction field doing? a wrapper?
        ],
        signers: [escrowAccount, initializerMainAccount],
        //QS: why does the escrowAccount need to sign? Is it the PDA signing?
      }
    );

    let _vault = await mintA.getAccountInfo(vault_account_pda);
    let _escrowAccount = await program.account.escrowAccount.fetch(
      escrowAccount.publicKey
    );

    //Check that the new vault owner is the PDA and that vault contains the
    //    inititalizer deposit
    assert.ok(_vault.owner.equals(vault_authority_pda));
    assert.ok(_vault.amount.toNumber() == initializerAmount);

    //Check that escrowAccount fields were properly set
    assert.ok(
      _escrowAccount.initializerKey.equals(initializerMainAccount.publicKey)
    );
    assert.ok(_escrowAccount.initializerAmount.toNumber() == initializerAmount);
    assert.ok(_escrowAccount.takerAmount.toNumber() == takerAmount);
    assert.ok(
      _escrowAccount.initializerDepositTokenAccount.equals(
        initializerTokenAccountA
      )
    );
    assert.ok(
      _escrowAccount.initializerReceiveTokenAccount.equals(
        initializerTokenAccountB
      )
    );
  });

  it("Exchange escrow(instruction)", async () => {
    await program.rpc.exchange({
      accounts: {
        taker: takerMainAccount.publicKey,
        takerDepositTokenAccount: takerTokenAccountB,
        takerReceiveTokenAccount: takerTokenAccountA,
        initializerDepositTokenAccount: initializerTokenAccountA,
        initializerReceiveTokenAccount: initializerTokenAccountB,
        initializer: initializerMainAccount.publicKey,
        escrowAccount: escrowAccount.publicKey,
        vaultAccount: vault_account_pda,
        vaultAuthority: vault_authority_pda,
        tokenProgram: spl_token.TOKEN_PROGRAM_ID,
      },
      signers: [takerMainAccount],
    });

    let _takerTokenAccountA = await mintA.getAccountInfo(takerTokenAccountA);
    let _takerTokenAccountB = await mintB.getAccountInfo(takerTokenAccountB);
    let _initializerTokenAccountA = await mintA.getAccountInfo(
      initializerTokenAccountA
    );
    let _initializerTokenAccountB = await mintB.getAccountInfo(
      initializerTokenAccountB
    );

    assert.ok(_takerTokenAccountA.amount.toNumber() == initializerAmount);
    assert.ok(_initializerTokenAccountB.amount.toNumber() == takerAmount);

    //QS: best way to test if the PDA vault is closed?
    try {
      await mintA.getAccountInfo(vault_account_pda);
    } catch (err) {
      return err;
    }
    assert.ok(err.toString() == "Error: Failed to find account");
  });

  it("Initialize escrow and cancel escrow", async () => {
    //refund initializer token A account
    await mintA.mintTo(
      initializerTokenAccountA,
      mintAuthority.publicKey,
      [mintAuthority],
      initializerAmount
    );

    await program.rpc.initializeEscrow(
      vault_account_bump,
      new anchor.BN(initializerAmount),
      new anchor.BN(takerAmount),
      {
        accounts: {
          initializer: initializerMainAccount.publicKey,
          vaultAccount: vault_account_pda,
          mint: mintA.publicKey,
          initializerDepositTokenAccount: initializerTokenAccountA,
          initializerReceiveTokenAccount: initializerTokenAccountB,
          escrowAccount: escrowAccount.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          tokenProgram: spl_token.TOKEN_PROGRAM_ID,
        },
        instructions: [
          await program.account.escrowAccount.createInstruction(escrowAccount),
        ],
        signers: [escrowAccount, initializerMainAccount],
      }
    );

    await program.rpc.cancelEscrow({
      accounts: {
        initializer: initializerMainAccount.publicKey,
        initializerDepositTokenAccount: initializerTokenAccountA,
        vaultAccount: vault_account_pda,
        vaultAuthority: vault_authority_pda,
        escrowAccount: escrowAccount.publicKey,
        tokenProgram: spl_token.TOKEN_PROGRAM_ID,
      },
      signers: [initializerMainAccount],
    });

    //QS: best way to test if the PDA vault is closed?
    try {
      await mintA.getAccountInfo(vault_account_pda);
    } catch (err) {
      return err;
    }
    assert.ok(err.toString() == "Error: Failed to find account");

    const _initializerTokenAccountA = await mint.getAccountInfo(
      initializerTokenAccountA
    );
    assert.ok(
      _initializerTokenAccountA.owner.equals(initializerMainAccount.publicKey)
    );

    assert.ok(_initializerTokenAccountA.amount.toNumber() == initializerAmount);
  });
});
