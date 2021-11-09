use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, SetAuthority, TokenAccount, Transfer};
use spl_token::instruction::AuthorityType;

//TODO: Verify program ID after each anchor build
declare_id!("67KSpEYQ7ndqVy3ZYFM3RUSMTdTrVXVCBrYof1qeADme");

#[program]
pub mod grand_bazaar {
    use super::*;

    const OFFER_PDA_SEED: &[u8] = b"offer";
    //QS: How is above stored? Can someone deserialize and get the seed and derive the vault authority?

    pub fn initialize_listing(
        ctx: Context<InitializeListing>,
        initializer_amount: u64,
    ) -> ProgramResult {
        ctx.accounts.listing_account.initializer_key = *ctx.accounts.initializer.key;
        //Q: Why do I need a deference here?
        //NTS: Sets escrow account initializer key to initializer.key (the signer)

        ctx.accounts
            .listing_account
            .initializer_deposit_token_account
        =
        *ctx.accounts
            .initializer_deposit_token_account
            .to_account_info()
            .key;
        //NTS: set pubkey of deposit token account as the escrow_accounts'related account's field

        ctx.accounts.listing_account.initializer_amount = initializer_amount;

        Ok(())
    }
    //NTS: To summarize  initialize_listing:set all fields in listing_account field to inputs
    //      No tokens are deposited nor transferred

    pub fn initialize_offer(
        ctx:Context<OfferEscrow>,
        _offer_vault_account_bump: u8,
        offeror_amount: u64,
        acceptor_amount: u64,
    ) -> ProgramResult {
        ctx.accounts.offer_account.offeror_key = *ctx.accounts.offeror.key;
        ctx.accounts
            .offer_account
            .offeror_deposit_token_account
        =
        *ctx.accounts
            .offeror_deposit_token_account
            .to_account_info()
            .key;

        ctx.accounts
            .offer_account
            .offeror_receive_token_account
        =
        *ctx.accounts
            .offeror_receive_token_account
            .to_account_info()
            .key;

        ctx.accounts.offer_account.offeror_amount = offeror_amount;
        ctx.accounts.offer_account.acceptor_amount = acceptor_amount;

        let(vault_authority, _vault_authority_bump) =
            Pubkey::find_program_address(&[OFFER_PDA_SEED], ctx.program_id);

        token::set_authority(
            ctx.accounts.into_set_authority_context(),
            AuthorityType::AccountOwner,
            Some(vault_authority),
        )?;

        token::transfer(
            ctx.accounts.into_transfer_to_pda_context(),
            ctx.accounts.offer_account.offeror_amount,
        )?;

        Ok(())

    }

    pub fn cancel_offer(ctx: Context<CancelOffer>) -> ProgramResult {
        let (_offer_vault_authority, offer_vault_account_bump) =
            Pubkey::find_program_address(&[OFFER_PDA_SEED], ctx.program_id);
        let authority_seeds = &[&OFFER_PDA_SEED[..], &[offer_vault_account_bump]];

        token::transfer(
            ctx.accounts
                .into_transfer_to_offeror_context()
                .with_signer(&[&authority_seeds[..]]),
            ctx.accounts.offer_account.offeror_amount,
        )?;

        token::close_account(
            ctx.accounts
                .into_close_context()
                .with_signer(&[&authority_seeds[..]]),
        )?;
        Ok(())
    }
    //NTS: To summarize cancel_escrow: derive PDA, transfer vault tokens back to offeror,
    //      closes offer_vault_account
    //QS: Don't we also need to close the EscrowAccount in addition to the vault_account?

    pub fn accept_offer(ctx: Context<AcceptOffer>) -> ProgramResult {
        let (_offer_vault_authority, offer_vault_authority_bump) =
            Pubkey::find_program_address(&[OFFER_PDA_SEED], ctx.program_id);
        let authority_seeds = &[&OFFER_PDA_SEED[..], &[offer_vault_authority_bump]];

        token::transfer(
            ctx.accounts.into_transfer_to_offeror_context(),
            ctx.accounts.offer_account.acceptor_amount,
        )?;

        token::transfer(
            ctx.accounts.into_transfer_to_acceptor_context()
                .with_signer(&[&authority_seeds[..]]),
            ctx.accounts.offer_account.offeror_amount,
        )?;

        token::close_account(
            ctx.accounts.into_close_context()
                .with_signer(&[&authority_seeds[..]]),
        )?;

        Ok(())

    }
}

#[derive(Accounts)]
#[instruction(initializer_amount:u64)]
//QS: Refresh what the instruction macro does. Does it feed in vault_account_bump in the below?
pub struct InitializeListing<'info> {
    #[account(mut, signer)]
    //NTS: Give this account ability to update state and to ensure it's the signer of tx
    pub initializer: AccountInfo<'info>,
    //QS: AccountInfo vs. Account struct? Believe AccountInfo is required field in Account
    pub mint: Account<'info, Mint>,
    //deserialize into Mint account?
    #[account(
        mut,
        constraint = initializer_deposit_token_account.amount >= initializer_amount
    )]
    pub initializer_deposit_token_account: Account<'info, TokenAccount>,
    #[account(zero)]
    pub listing_account: ProgramAccount<'info, ListingAccount>,
}

#[derive(Accounts)]
#[instruction(offer_vault_account_bump:u8, offeror_amount:u64)]
pub struct OfferEscrow<'info> {
    #[account(mut, signer)]
    pub offeror: AccountInfo<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        seeds = [b"offer-seed".as_ref()],
        bump = offer_vault_account_bump,
        payer = offeror,
        token::mint = mint,
        token::authority = offeror,
    )]
    pub offer_vault_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = offeror_deposit_token_account.amount >= offeror_amount
    )]
    pub offeror_deposit_token_account: Account<'info, TokenAccount>,
    pub offeror_receive_token_account: Account<'info, TokenAccount>,
    pub offer_account: ProgramAccount<'info, OfferAccount>,
    pub system_program: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CancelOffer<'info> {
    #[account(mut, signer)]
    pub offeror: AccountInfo<'info>,
    #[account(mut)]
    pub offer_vault_account: Account<'info, TokenAccount>,
    pub offer_vault_authority: AccountInfo<'info>,
    #[account(mut)]
    pub offeror_deposit_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = offer_account.offeror_key == *offeror.key,
        constraint =
            offer_account.offeror_deposit_token_account ==
            *offeror_deposit_token_account.to_account_info().key,
            //NTS: I see why this is here but potential bug possible if offer migrated token
            //      acounts after inititalizing right?
        close = offeror
    )]
    pub offer_account: ProgramAccount<'info, OfferAccount>,
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct AcceptOffer<'info> {
    #[account(signer)]
    pub acceptor: AccountInfo<'info>,
    #[account(mut)]
    pub acceptor_deposit_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub acceptor_receive_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub offeror_deposit_token_account: Account<'info, TokenAccount>,
    //QS: same potential migration bug?
    #[account(mut)]
    pub offeror_receive_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub offeror: AccountInfo<'info>,
    #[account(
        mut,
        constraint = offer_account.acceptor_amount <= acceptor_deposit_token_account.amount,
        constraint =
            offer_account.offeror_deposit_token_account ==
            *offeror_deposit_token_account.to_account_info().key,
        constraint =
            offer_account.offeror_receive_token_account ==
            *offeror_receive_token_account.to_account_info().key,
        constraint = offer_account.offeror_key == *offeror.key,
        close = offeror
    )]
    pub offer_account: ProgramAccount<'info, OfferAccount>,
    #[account(mut)]
    pub offer_vault_account: Account<'info, TokenAccount>,
    pub offer_vault_authority: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
}


#[account]
pub struct ListingAccount{
    pub initializer_key: Pubkey,
    pub initializer_deposit_token_account: Pubkey,
    pub initializer_amount: u64,
}

#[account]
pub struct OfferAccount{
    pub offeror_key: Pubkey,
    pub offeror_deposit_token_account: Pubkey,
    pub offeror_receive_token_account: Pubkey,
    pub offeror_amount: u64,
    pub acceptor_amount: u64,
}

impl <'info> OfferEscrow<'info> {

    fn into_set_authority_context(&self) -> CpiContext<'_, '_, '_, 'info, SetAuthority<'info>> {
        let cpi_accounts = SetAuthority {
            account_or_mint: self.offer_vault_account.to_account_info().clone(),
            current_authority: self.offeror.clone(),
        };
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }

    fn into_transfer_to_pda_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.offeror_deposit_token_account.to_account_info().clone(),
            to: self.offer_vault_account.to_account_info().clone(),
            authority: self.offeror.clone(),
        };
        CpiContext::new(self.token_program.clone(), cpi_accounts)
    }
    //NTS: Above function creates a cpi of token::Transfer and transfers deposit tokens from wallet
    //     token account to vault deposit token account. cpi_accounts is more like instructions+
    //     accounts
    //QS: Do we not need to create a token account for vault_account to hold the deposited tokens?
    //A: Vault account is already a token account so no need?

}

impl <'info> CancelOffer<'info> {
    fn into_transfer_to_offeror_context(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.offer_vault_account.to_account_info().clone(),
            to: self.offeror_deposit_token_account.to_account_info().clone(),
            //NTS: same potential problem with migration as before right?
            authority: self.offer_vault_authority.clone(),
        };

        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }

    fn into_close_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self.offer_vault_account.to_account_info().clone(),
            destination: self.offeror.clone(),
            authority: self.offer_vault_authority.clone(),
        };
        //QS: What's happening under hood here? Why destination for close account?
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

impl <'info> AcceptOffer<'info> {
    fn into_transfer_to_offeror_context(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.acceptor_deposit_token_account.to_account_info().clone(),
            to: self.offeror_receive_token_account.to_account_info().clone(),
            authority: self.acceptor.clone(),
        };
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }

    fn into_transfer_to_acceptor_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.offer_vault_account.to_account_info().clone(),
            to: self.acceptor_receive_token_account.to_account_info().clone(),
            authority: self.offer_vault_authority.clone(),
        };
        CpiContext::new(self.token_program.clone(), cpi_accounts)

    }

    fn into_close_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self.offer_vault_account.to_account_info().clone(),
            destination: self.offeror.clone(),
            authority: self.offer_vault_authority.clone(),
        };
        CpiContext::new(self.token_program.clone(), cpi_accounts)
    }
}
