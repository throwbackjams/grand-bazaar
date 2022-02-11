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

  console.log("Listing Account: ", listingAccount.publicKey.toBase58());
  console.log("Offer 1 Account: ",offer1Account.publicKey.toBase58());
  console.log("Offer 2 Account: ", offer2Account.publicKey.toBase58());
  console.log("Payer: ", payer.publicKey.toBase58());
  console.log("Mint Authority: ",mintAuthority.publicKey.toBase58());
  console.log("Offeror 1 Main Account: ", offeror1MainAccount.publicKey.toBase58());
  console.log("Offeror 2 Main Account: ", offeror2MainAccount.publicKey.toBase58());
  console.log("Acceptor Main Account: ", acceptorMainAccount.publicKey.toBase58());
  console.log("Offer 1 Amount:", offer1Amount);
  console.log("Offer 2 Amount:", offer2Amount);
  console.log("Acceptor Amount:", acceptorAmount);

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
      [Buffer.from(anchor.utils.bytes.utf8.encode("offer-seed")), offeror1MainAccount.publicKey.toBuffer()],
      program.programId
    );

    offer_vault_account_pda = _offer_vault_account_pda;
    offer_vault_account_bump = _offer_vault_account_bump;

    const [
      _offer_vault_authority_pda,
      _offer_vault_authority_bump,
    ] = await web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("offer")), offeror1MainAccount.publicKey.toBuffer()],
      program.programId
    );

    offer_vault_authority_pda = _offer_vault_authority_pda;

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

    let _offerVault = await mintA.getAccountInfo(offer_vault_account_pda);

    let _offerAccount = await program.account.offerAccount.fetch(
      offer1Account.publicKey
    );

    console.log("Offer 1 vault account PDA: ", offer_vault_account_pda.toBase58());
    console.log("Offer 1 vault authority PDA: ", offer_vault_authority_pda.toBase58());
    console.log("offerAccount.Offerkey: ", _offerAccount.offerorKey.toBase58());
    console.log("offerAccount.offeror_amount: ", _offerAccount.offerorAmount.toNumber());
    console.log("offerAccount.acceptor_amount: ", _offerAccount.acceptorAmount.toNumber());
    
    assert.ok(_offerVault.owner.equals(offer_vault_authority_pda));
    assert.ok(_offerVault.amount.toNumber() == offer1Amount);

    assert.ok(_offerAccount.offerorKey.equals(offeror1MainAccount.publicKey));
    assert.ok(_offerAccount.offerorDepositTokenAccount.equals(offeror1TokenAccountA));
    assert.ok(_offerAccount.offerorReceiveTokenAccount.equals(offeror1TokenAccountB));
    assert.ok(_offerAccount.offerorAmount.toNumber() == offer1Amount);
    assert.ok(_offerAccount.acceptorAmount.toNumber() == acceptorAmount);

  });

  it("Initialize offer 2", async () => {

    const [
      _offer_vault_account_pda,
      _offer_vault_account_bump,
    ] = await web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("offer-seed")), offeror2MainAccount.publicKey.toBuffer()],
      program.programId
    );

    offer_vault_account_pda = _offer_vault_account_pda;
    offer_vault_account_bump = _offer_vault_account_bump;

    const [
      _offer_vault_authority_pda,
      _offer_vault_authority_bump,
    ] = await web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("offer")), offeror2MainAccount.publicKey.toBuffer()],
      program.programId
    );

    offer_vault_authority_pda = _offer_vault_authority_pda;

    await program.rpc.initializeOffer(
      offer_vault_account_bump,
      new anchor.BN(offer2Amount),
      new anchor.BN(acceptorAmount),
      {
        accounts: {
          offeror: offeror2MainAccount.publicKey,
          offerVaultAccount: offer_vault_account_pda,
          mint: mintA.publicKey,
          offerorDepositTokenAccount: offeror2TokenAccountA,
          offerorReceiveTokenAccount: offeror2TokenAccountB,
          offerAccount: offer2Account.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          tokenProgram: spl_token.TOKEN_PROGRAM_ID,
        },
        instructions: [
          await program.account.offerAccount.createInstruction(offer2Account),
        ],
        signers: [offer2Account, offeror2MainAccount],
      }
    );

    let _offerVault = await mintA.getAccountInfo(offer_vault_account_pda);

    let _offerAccount = await program.account.offerAccount.fetch(offer2Account.publicKey);
    
    console.log("Offer 2 vault account PDA: ", offer_vault_account_pda.toBase58());
    console.log("Offer 2 vault authority PDA: ", offer_vault_authority_pda.toBase58());
    console.log("offerAccount.Offerkey: ", _offerAccount.offerorKey.toBase58());
    console.log("offerAccount.offeror_amount: ", _offerAccount.offerorAmount.toNumber());
    console.log("offerAccount.acceptor_amount: ", _offerAccount.acceptorAmount.toNumber());

    assert.ok(_offerVault.owner.equals(offer_vault_authority_pda));
    assert.ok(_offerVault.amount.toNumber() == offer2Amount);

    assert.ok(_offerAccount.offerorKey.equals(offeror2MainAccount.publicKey));
    assert.ok(_offerAccount.offerorDepositTokenAccount.equals(offeror2TokenAccountA));
    assert.ok(_offerAccount.offerorReceiveTokenAccount.equals(offeror2TokenAccountB));
    assert.ok(_offerAccount.offerorAmount.toNumber() == offer2Amount);
    assert.ok(_offerAccount.acceptorAmount.toNumber() == acceptorAmount);

  });

  it("Accept offer 2", async() => {

    const [
      _offer_vault_account_pda,
      _offer_vault_account_bump,
    ] = await web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("offer-seed")), offeror2MainAccount.publicKey.toBuffer()],
      program.programId
    );

    offer_vault_account_pda = _offer_vault_account_pda;
    offer_vault_account_bump = _offer_vault_account_bump;

    const [
      _offer_vault_authority_pda,
      _offer_vault_authority_bump,
    ] = await web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("offer")), offeror2MainAccount.publicKey.toBuffer()],
      program.programId
    );

    offer_vault_authority_pda = _offer_vault_authority_pda;

    await program.rpc.acceptOffer(
      {
        accounts: {
          acceptor: acceptorMainAccount.publicKey,
          acceptorDepositTokenAccount: acceptorTokenAccountB,
          acceptorReceiveTokenAccount: acceptorTokenAccountA,
          offerorDepositTokenAccount: offeror2TokenAccountA,
          offerorReceiveTokenAccount: offeror2TokenAccountB,
          offeror: offeror2MainAccount.publicKey,
          offerAccount: offer2Account.publicKey,
          offerVaultAccount: offer_vault_account_pda,
          offerVaultAuthority: offer_vault_authority_pda,
          tokenProgram: spl_token.TOKEN_PROGRAM_ID,
        },
        signers: [acceptorMainAccount]
      }
    );

    let _acceptorTokenAccountA = await mintA.getAccountInfo(acceptorTokenAccountA);

    assert.ok(_acceptorTokenAccountA.amount.toNumber() == offer2Amount);

    let _acceptorTokenAccountB = await mintB.getAccountInfo(acceptorTokenAccountB);
    let _offeror2TokenAccountA = await mintA.getAccountInfo(offeror2TokenAccountA); 
    let _offeror2TokenAccountB = await mintB.getAccountInfo(offeror2TokenAccountB); 
    let _offeror1TokenAccountA = await mintA.getAccountInfo(offeror1TokenAccountA); 
    let _offeror1TokenAccountB = await mintB.getAccountInfo(offeror1TokenAccountB); 

    assert.ok(_acceptorTokenAccountA.amount.toNumber() == offer2Amount);
    assert.ok(_acceptorTokenAccountB.amount.toNumber() == 0);
    assert.ok(_offeror2TokenAccountA.amount.toNumber() == 0);
    assert.ok(_offeror2TokenAccountB.amount.toNumber() == acceptorAmount);
    assert.ok(_offeror1TokenAccountA.amount.toNumber() == 0);
    assert.ok(_offeror1TokenAccountB.amount.toNumber() == 0);

    console.log("acceptorTokenAccountA: ", _acceptorTokenAccountA.amount.toNumber());
    console.log("acceptorTokenAccountB: ", _acceptorTokenAccountB.amount.toNumber());
    console.log("offeror2TokenAccountA: ", _offeror2TokenAccountA.amount.toNumber());
    console.log("offeror2TokenAccountB: ", _offeror2TokenAccountB.amount.toNumber());
    console.log("offeror1TokenAccountA: ", _offeror1TokenAccountA.amount.toNumber());
    console.log("offeror1TokenAccountB: ", _offeror1TokenAccountB.amount.toNumber());

    //Check if offer vault is closed properly
    try {
      await mintA.getAccountInfo(offer_vault_account_pda);
    } catch (err) {
      return err;
    }

    assert.ok(err.toString() == "Error: Failed to find account")


  });

  it("cancel offer 1 (close & return deposit)", async () => {

    const [
      _offer_vault_account_pda,
      _offer_vault_account_bump,
    ] = await web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("offer-seed")), offeror1MainAccount.publicKey.toBuffer()],
      program.programId
    );

    offer_vault_account_pda = _offer_vault_account_pda;
    offer_vault_account_bump = _offer_vault_account_bump;

    const [
      _offer_vault_authority_pda,
      _offer_vault_authority_bump,
    ] = await web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("offer")), offeror1MainAccount.publicKey.toBuffer()],
      program.programId
    );

    offer_vault_authority_pda = _offer_vault_authority_pda;

    console.log("offeror1MainAccount: ", offeror1MainAccount.publicKey.toBase58());

    await program.rpc.cancelOffer(
      {
        accounts: {
          offeror: offeror1MainAccount.publicKey,
          offerVaultAccount: offer_vault_account_pda,
          offerVaultAuthority: offer_vault_authority_pda,
          offerorDepositTokenAccount: offeror1TokenAccountA,
          offerAccount: offer1Account.publicKey,
          tokenProgram: spl_token.TOKEN_PROGRAM_ID,
        },
        signers: [offeror1MainAccount]
      }
    );

    const _offeror1TokenAccountA = await mintA.getAccountInfo(offeror1TokenAccountA);
    assert.ok(_offeror1TokenAccountA.owner.equals(offeror1MainAccount.publicKey));
    assert.ok(_offeror1TokenAccountA.amount.toNumber() == offer1Amount);

  });
  //test to cancel offer 1 , close the vault account and return the deposit tokens to offeroer1TokenAccountA

  // it("View both offer 1 and offer 2 and accept offer 2", async () => {
  //   let _offer1Account = await program.account.offerAccount.fetch(offer1Account.publicKey)
  //   let _offer2Account = await program.account.offerAccount.fetch(offer2Account.publicKey);

  //   console.log(_offer1Account.offerorAmount.toNumber());
  //   console.log(_offer2Account.offerorAmount.toNumber());
  //   assert.ok(_offer1Account.offerorAmount.toNumber() == offer1Amount);
  //   assert.ok(_offer2Account.offerorAmount.toNumber() == offer2Amount);

  //   const [
  //     _offer_vault_account_pda,
  //     _offer_vault_account_bump,
  //   ] = await web3.PublicKey.findProgramAddress(
  //     [Buffer.from(anchor.utils.bytes.utf8.encode("offer-seed")), offeror2MainAccount.publicKey.toBuffer()],
  //     program.programId
  //   );

  //   offer_vault_account_pda = _offer_vault_account_pda;
  //   offer_vault_account_bump = _offer_vault_account_bump;

  //   const [
  //     _offer_vault_authority_pda,
  //     _offer_vault_authority_bump,
  //   ] = await web3.PublicKey.findProgramAddress(
  //     [Buffer.from(anchor.utils.bytes.utf8.encode("offer")), offeror2MainAccount.publicKey.toBuffer()],
  //     program.programId
  //   );

  //   offer_vault_authority_pda = _offer_vault_authority_pda;

  //   await program.rpc.acceptOffer(
  //     {
  //       accounts: {
  //         acceptor: acceptorMainAccount.publicKey,
  //         acceptorDepositTokenAccount: acceptorTokenAccountB,
  //         acceptorReceiveTokenAccount: acceptorTokenAccountA,
  //         offerorDepositTokenAccount: offer2Account.offerorDepositTokenAccount,
  //         offerorReceiveTokenAccount: offer2Account.offerorReceiveTokenAccount,
  //         offeror: offer2Account.offerorKey,
  //         offerAccount: offer2Account.publicKey,
  //         offerVaultAccount: offer_vault_account_pda,
  //         offerVaultAuthority: offer_vault_authority_pda,
  //         tokenProgram: spl_token.TOKEN_PROGRAM_ID,
  //       },
  //       signers: [acceptorMainAccount]
  //     }
  //   );

  //   let acceptorTokenAccountA = await mintA.getAccountInfo(acceptorTokenAccountA);
  //   let acceptorTokenAccountB = await mintA.getAccountInfo(acceptorTokenAccountB);
  //   let offeror2TokenAccountA = await mintA.getAccountInfo(offeror2TokenAccountA); 
  //   let offeror2TokenAccountB = await mintA.getAccountInfo(offeror2TokenAccountB); 
  //   let offeror1TokenAccountA = await mintA.getAccountInfo(offeror1TokenAccountA); 
  //   let offeror1TokenAccountB = await mintA.getAccountInfo(offeror1TokenAccountB); 

  //   assert.ok(acceptorTokenAccountA.amount.toNumber() == offer2Amount);
  //   assert.ok(acceptorTokenAccountB.amount.toNumber() == 0);
  //   assert.ok(offeror2TokenAccountA.amount.toNumber() == 0);
  //   assert.ok(offeror2TokenAccountB.amount.toNumber() == acceptorAmount);
  //   assert.ok(offeror1TokenAccountA.amount.toNumber() == offer1Amount);
  //   assert.ok(offeror1TokenAccountB.amount.toNumber() == 0);

  //   console.log("acceptorTokenAccountA: ", acceptorTokenAccountA.amount.toNumber());
  //   console.log("acceptorTokenAccountB: ", acceptorTokenAccountB.amount.toNumber());
  //   console.log("offeror2TokenAccountA: ", offeror2TokenAccountA.amount.toNumber());
  //   console.log("offeror2TokenAccountB: ", offeror2TokenAccountB.amount.toNumber());
  //   console.log("offeror1TokenAccountA: ", offeror1TokenAccountA.amount.toNumber());
  //   console.log("offeror1TokenAccountA: ", offeror1TokenAccountB.amount.toNumber());

  //   try {
  //     await mintA.getAccountInfo(offer_vault_account_pda);
  //   } catch (err) {
  //     console.log(err);
  //     return err;
  //   }

  //   assert.ok(err.toString() == "Error: Failed to find account")

  // });


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
