const assert = require("assert");
const anchor = require("@project-serum/anchor");
const { SystemProgram } = anchor.web3;
const web3 = require("@solana/web3.js");
const spl_token = require("@solana/spl-token");

describe("grand-bazaar multiple offers 2 token unit test", () => {
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.GrandBazaar;

  let mintA = null;
  let mintB = null;
  let offeror1TokenAccountA = null;
  let offeror1TokenAccountB = null;
  let offeror2TokenAccountA = null;
  let offeror2TokenAccountB = null;
  let acceptorTokenAccountA = null;
  let acceptorTokenAccountB = null;
  let offer_vault_account_pda = null;
  let offer_vault_account_bump = null;
  let offer_vault_authority_pda = null;
  //QS: Will offer vault authority be same for each offer?
  const acceptorAmount = 1000;
  const offer1Amount = 500;
  const offer2Amount = 700;

  const listingAccount = anchor.web3.Keypair.generate();
  const offer1Account = anchor.web3.Keypair.generate();
  const offer2Account = anchor.web3.Keypair.generate();
  const payer = anchor.web3.Keypair.generate();
  const mintAuthority = anchor.web3.Keypair.generate();
  const offeror1MainAccount = anchor.web3.Keypair.generate();
  const offeror2MainAccount = anchor.web3.Keypair.generate();
  const acceptorMainAccount = anchor.web3.Keypair.generate();

  it("initialize starting state", async () => {
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
            toPubkey: offeror1MainAccount.publicKey,
            lamports: 1000000000,
          }),
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: acceptorMainAccount.publicKey,
            lamports: 1000000000,
          }),
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: offeror2MainAccount.publicKey,
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

    offeror1TokenAccountA = await mintA.createAccount(
      offeror1MainAccount.publicKey
    );
    offeror2TokenAccountA = await mintA.createAccount(
      offeror2MainAccount.publicKey
    );
    acceptorTokenAccountA = await mintA.createAccount(
      acceptorMainAccount.publicKey
    );

    offeror1TokenAccountB = await mintB.createAccount(
      offeror1MainAccount.publicKey
    );
    offeror2TokenAccountB = await mintB.createAccount(
      offeror2MainAccount.publicKey
    );
    acceptorTokenAccountB = await mintB.createAccount(
      acceptorMainAccount.publicKey
    );

    await mintA.mintTo(
      offeror1TokenAccountA,
      mintAuthority.publicKey,
      [mintAuthority],
      offer1Amount
    );

    await mintA.mintTo(
      offeror2TokenAccountA,
      mintAuthority.publicKey,
      [mintAuthority],
      offer2Amount
    );

    await mintB.mintTo(
      acceptorTokenAccountB,
      mintAuthority.publicKey,
      [mintAuthority],
      acceptorAmount
    );

    let _offeror1TokenAccountA = await mintA.getAccountInfo(
      offeror1TokenAccountA
    );

    let _offeror2TokenAccountA = await mintA.getAccountInfo(
      offeror2TokenAccountA
    );

    let _acceptorTokenAccountB = await mintB.getAccountInfo(
      acceptorTokenAccountB
    );

    assert.ok(_offeror1TokenAccountA.amount.toNumber() == offer1Amount);
    assert.ok(_offeror2TokenAccountA.amount.toNumber() == offer2Amount);

    assert.ok(_acceptorTokenAccountB.amount.toNumber() == acceptorAmount);
  });

  it("Initialize listing", async () => {
    await program.rpc.initializeListing(new anchor.BN(acceptorAmount), {
      accounts: {
        initializer: acceptorMainAccount.publicKey,
        mint: mintB.publicKey,
        initializerDepositTokenAccount: acceptorTokenAccountB,
        listingAccount: listingAccount.publicKey,
      },
      instructions: [
        await program.account.listingAccount.createInstruction(listingAccount),
        //Still not quite sure what's going on here
      ],
      signers: [listingAccount, acceptorMainAccount],
    });

    let _listingAccount = await program.account.listingAccount.fetch(
      listingAccount.publicKey
    );

    assert.ok(
      _listingAccount.initializerKey.equals(acceptorMainAccount.publicKey)
    );

    assert.ok(
      _listingAccount.initializerDepositTokenAccount.equals(
        acceptorTokenAccountB
      )
    );

    assert.ok(_listingAccount.initializerAmount.toNumber() == acceptorAmount);
  });

  it("Initialize offer 1", async () => {
    const [
      _offer_vault_account_pda,
      _offer_vault_account_bump,
    ] = await web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("offer-seed"))],
      program.programId
    );

    offer_vault_account_pda = _offer_vault_account_pda;
    offer_vault_account_bump = _offer_vault_account_bump;

    const [
      _offer_vault_authority_pda,
      _offer_vault_authority_bump,
    ] = await web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("offer"))],
      program.programId
    );

    offer_vault_authority_pda = _offer_vault_account_pda;

    await program.rpc.initializeOffer(
      offer_vault_account_bump,
      new anchor.BN(offer1Amount),
      new anchor.BN(acceptorAmount),
      {
        accounts: {
          offeror: offeror1MainAccount.publicKey,
          offerVaultAccount: offer_vault_account_pda,
          mint: mintA.publicKey,
          offerorDepositTokenAccount: offeror1TokenAccountA,
          offerorReceiveTokenAccount: offeror1TokenAccountB,
          offerAccount: offer1Account.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          tokenProgram: spl_token.TOKEN_PROGRAM_ID,
        },
        instructions: [
          await program.account.offerAccount.createInstruction(offer1Account),
        ],
        signers: [offer1Account, offeror1MainAccount],
      }
    );

    let _offer_vault = await mintA.getAccountInfo(offer_vault_account_pda);

    let _offer_account = await program.accounts.offerAccount.fetch(
      offerAccount.publicKey
    );
  });
  //
  // it("Initialize escrow (instruction)", async () => {
  //   const [
  //     _vault_account_pda,
  //     _vault_account_bump,
  //   ] = await web3.PublicKey.findProgramAddress(
  //     [Buffer.from(anchor.utils.bytes.utf8.encode("token-seed"))],
  //     program.programId
  //   );
  //
  //   vault_account_pda = _vault_account_pda;
  //   vault_account_bump = _vault_account_bump;
  //
  //   const [
  //     _vault_authority_pda,
  //     _vault_authority_bump,
  //   ] = await web3.PublicKey.findProgramAddress(
  //     [Buffer.from(anchor.utils.bytes.utf8.encode("escrow"))],
  //     program.programId
  //   );
  //
  //   vault_authority_pda = _vault_authority_pda;
  //
  //   await program.rpc.initializeEscrow(
  //     vault_account_bump,
  //     new anchor.BN(initializerAmount),
  //     new anchor.BN(takerAmount),
  //     {
  //       accounts: {
  //         initializer: initializerMainAccount.publicKey,
  //         vaultAccount: vault_account_pda,
  //         mint: mintA.publicKey,
  //         initializerDepositTokenAccount: initializerTokenAccountA,
  //         initializerReceiveTokenAccount: initializerTokenAccountB,
  //         escrowAccount: escrowAccount.publicKey,
  //         systemProgram: anchor.web3.SystemProgram.programId,
  //         rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  //         tokenProgram: spl_token.TOKEN_PROGRAM_ID,
  //       },
  //       instructions: [
  //         await program.account.escrowAccount.createInstruction(escrowAccount),
  //         //QS: what is this instruction field doing? a wrapper?
  //       ],
  //       signers: [escrowAccount, initializerMainAccount],
  //       //QS: why does the escrowAccount need to sign? Is it the PDA signing?
  //     }
  //   );
  //
  //   let _vault = await mintA.getAccountInfo(vault_account_pda);
  //   let _escrowAccount = await program.account.escrowAccount.fetch(
  //     escrowAccount.publicKey
  //   );
  //
  //   //Check that the new vault owner is the PDA and that vault contains the
  //   //    inititalizer deposit
  //   assert.ok(_vault.owner.equals(vault_authority_pda));
  //   assert.ok(_vault.amount.toNumber() == initializerAmount);
  //
  //   //Check that escrowAccount fields were properly set
  //   assert.ok(
  //     _escrowAccount.initializerKey.equals(initializerMainAccount.publicKey)
  //   );
  //   assert.ok(_escrowAccount.initializerAmount.toNumber() == initializerAmount);
  //   assert.ok(_escrowAccount.takerAmount.toNumber() == takerAmount);
  //   assert.ok(
  //     _escrowAccount.initializerDepositTokenAccount.equals(
  //       initializerTokenAccountA
  //     )
  //   );
  //   assert.ok(
  //     _escrowAccount.initializerReceiveTokenAccount.equals(
  //       initializerTokenAccountB
  //     )
  //   );
  // });
  //
  // it("Exchange escrow(instruction)", async () => {
  //   await program.rpc.exchange({
  //     accounts: {
  //       taker: takerMainAccount.publicKey,
  //       takerDepositTokenAccount: takerTokenAccountB,
  //       takerReceiveTokenAccount: takerTokenAccountA,
  //       initializerDepositTokenAccount: initializerTokenAccountA,
  //       initializerReceiveTokenAccount: initializerTokenAccountB,
  //       initializer: initializerMainAccount.publicKey,
  //       escrowAccount: escrowAccount.publicKey,
  //       vaultAccount: vault_account_pda,
  //       vaultAuthority: vault_authority_pda,
  //       tokenProgram: spl_token.TOKEN_PROGRAM_ID,
  //     },
  //     signers: [takerMainAccount],
  //   });
  //
  //   let _takerTokenAccountA = await mintA.getAccountInfo(takerTokenAccountA);
  //   let _takerTokenAccountB = await mintB.getAccountInfo(takerTokenAccountB);
  //   let _initializerTokenAccountA = await mintA.getAccountInfo(
  //     initializerTokenAccountA
  //   );
  //   let _initializerTokenAccountB = await mintB.getAccountInfo(
  //     initializerTokenAccountB
  //   );
  //
  //   assert.ok(_takerTokenAccountA.amount.toNumber() == initializerAmount);
  //   assert.ok(_initializerTokenAccountB.amount.toNumber() == takerAmount);
  //
  //   //QS: best way to test if the PDA vault is closed?
  //   try {
  //     await mintA.getAccountInfo(vault_account_pda);
  //   } catch (err) {
  //     return err;
  //   }
  //   assert.ok(err.toString() == "Error: Failed to find account");
  // });
  //
  // it("Initialize escrow and cancel escrow", async () => {
  //   //refund initializer token A account
  //   await mintA.mintTo(
  //     initializerTokenAccountA,
  //     mintAuthority.publicKey,
  //     [mintAuthority],
  //     initializerAmount
  //   );
  //
  //   await program.rpc.initializeEscrow(
  //     vault_account_bump,
  //     new anchor.BN(initializerAmount),
  //     new anchor.BN(takerAmount),
  //     {
  //       accounts: {
  //         initializer: initializerMainAccount.publicKey,
  //         vaultAccount: vault_account_pda,
  //         mint: mintA.publicKey,
  //         initializerDepositTokenAccount: initializerTokenAccountA,
  //         initializerReceiveTokenAccount: initializerTokenAccountB,
  //         escrowAccount: escrowAccount.publicKey,
  //         systemProgram: anchor.web3.SystemProgram.programId,
  //         rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  //         tokenProgram: spl_token.TOKEN_PROGRAM_ID,
  //       },
  //       instructions: [
  //         await program.account.escrowAccount.createInstruction(escrowAccount),
  //       ],
  //       signers: [escrowAccount, initializerMainAccount],
  //     }
  //   );
  //
  //   await program.rpc.cancelEscrow({
  //     accounts: {
  //       initializer: initializerMainAccount.publicKey,
  //       initializerDepositTokenAccount: initializerTokenAccountA,
  //       vaultAccount: vault_account_pda,
  //       vaultAuthority: vault_authority_pda,
  //       escrowAccount: escrowAccount.publicKey,
  //       tokenProgram: spl_token.TOKEN_PROGRAM_ID,
  //     },
  //     signers: [initializerMainAccount],
  //   });
  //
  //   //QS: best way to test if the PDA vault is closed?
  //   try {
  //     await mintA.getAccountInfo(vault_account_pda);
  //   } catch (err) {
  //     return err;
  //   }
  //   assert.ok(err.toString() == "Error: Failed to find account");
  //
  //   const _initializerTokenAccountA = await mint.getAccountInfo(
  //     initializerTokenAccountA
  //   );
  //   assert.ok(
  //     _initializerTokenAccountA.owner.equals(initializerMainAccount.publicKey)
  //   );
  //
  //   assert.ok(_initializerTokenAccountA.amount.toNumber() == initializerAmount);
  // });
});
