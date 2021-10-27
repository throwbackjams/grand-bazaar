use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, SetAuthority, TokenAccount, Transfer};
use spl_token::instruction::AuthorityType;

//TODO: Verify program ID after each anchor build
declare_id!("67KSpEYQ7ndqVy3ZYFM3RUSMTdTrVXVCBrYof1qeADme");

#[program]
pub mod grand_bazaar {
    use super::*;

    const ESCROW_PDA_SEED: &[u8] = b"escrow";
    //QS: How is above stored? Can someone deserialize and get the seed?

    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        _vault_account_bump: u8,
        initializer_amount: u64,
        taker_amount: u64,
    ) -> ProgramResult {
        ctx.accounts.escrow_account.initializer_key = *ctx.accounts.initializer.key;
        //Q: Why do I need a deference here?
        //NTS: Sets escrow account initializer key to initializer.key (the signer)

        ctx.accounts
            .escrow_account
            .initializer_deposit_token_account
        =
        *ctx.accounts
            .initializer_deposit_token_account
            .to_account_info()
            .key;
        //NTS: set pubkey of deposit token account as the escrow_accounts'related account's field

        ctx.accounts
            .escrow_account
            .initializer_receive_token_account
        =
        *ctx.accounts
            .initializer_receive_token_account
            .to_account_info()
            .key;
        ctx.accounts.escrow_account.initializer_amount = initializer_amount;
        ctx.accounts.escrow_account.taker_amount = taker_amount;
        //NTS: Set the rest of the escrow_account fields as specified by the inputs

        let (vault_authority, _vault_authority_bump) =
            Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);
        //QS: Why doesn't ctx.program_id need to be a reference?
        //NTS: creates a PDA to be the EscrowAccount authority

        token::set_authority(
            ctx.accounts.into_set_authority_context(),
            AuthorityType::AccountOwner,
            Some(vault_authority),
        )?;
        //NTS: Ah! this last line sets the authority of vault_account to the PDA per
        //     anchor-spl docs on token::set_authority()


        token::transfer(
            ctx.accounts.into_transfer_to_pda_context(),
            ctx.accounts.escrow_account.initializer_amount,
        )?;

        Ok(())
    }
    //NTS: To summarize initialize_escrow:
    //(i) set all fields in escrow_account field to inputs
    //(ii) create PDA, then set authority of vault_account to the PDA
    //(iii) transfer deposit tokens from the initializer_deposit_token_account to the vault

    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> ProgramResult {
        let (_vault_authority, vault_account_bump) =
            Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);
        let authority_seeds = &[&ESCROW_PDA_SEED[..], &[vault_account_bump]];

        token::transfer(
            ctx.accounts
                .into_transfer_to_initializer_context()
                .with_signer(&[&authority_seeds[..]]),
                //QS: What is above line doing? Why need it?
            ctx.accounts.escrow_account.initializer_amount,
        )?;

        token::close_account(
            ctx.accounts
                .into_close_context()
                .with_signer(&[&authority_seeds[..]]),
        )?;
        Ok(())
    }
    //NTS: To summarize cancel_escrow: derive PDA, transfer vault tokens back to initializer,
    //      closes vault_accounts
    //QS: Don't quite understand what authority_seeds is doing. Docs not very expressive
    //QS: Don't we also need to close the EscrowAccount in addition to the vault_account?

    pub fn exchange(ctx: Context<Exchange>) -> ProgramResult {
        let (_vault_authority, vault_authority_bump) =
            Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);
        let authority_seeds = &[&ESCROW_PDA_SEED[..], &[vault_authority_bump]];

        token::transfer(
            ctx.accounts.into_transfer_to_initializer_context(),
            ctx.accounts.escrow_account.taker_amount,
        )?;

        token::transfer(
            ctx.accounts.into_transfer_to_taker_context()
                .with_signer(&[&authority_seeds[..]]),
                //NTS: Ah! okay so when the transfer authority is not the signer of the current tx,
                //      here signer = taker and transfer authority = PDA,
                //      you will need to sign with PDA seeds, which is a combo of ESCROW_PDA_SEED
                //      and vault_authority_bump..
                //QS: But could someone theoretically take control of the PDA if they found
                //      ESCROW_PDA_SEED??
            ctx.accounts.escrow_account.initializer_amount,
        )?;

        token::close_account(
            ctx.accounts.into_close_context()
                .with_signer(&[&authority_seeds[..]]),
        )?;

        Ok(())

    }
}

#[derive(Accounts)]
#[instruction(vault_account_bump: u8, initializer_amount:u64)]
//QS: Refresh what the instruction macro does. Does it feed in vault_account_bump in the below?
pub struct InitializeEscrow<'info> {
    #[account(mut, signer)]
    //NTS: Give this account ability to update state and to ensure it's the signer of tx
    pub initializer: AccountInfo<'info>,
    //QS: AccountInfo vs. Account struct? Believe AccountInfo is required field in Account
    pub mint: Account<'info, Mint>,
    //deserialize into Mint account?

    #[account(
        init,
        seeds = [b"token-seed".as_ref()],
        bump = vault_account_bump,
        payer = initializer,
        token::mint = mint,
        token::authority = initializer,
    )]
    pub vault_account: Account<'info, TokenAccount>,
    //QS: Is a PDA. What does last two lines do? Does initializer have authority over vault_account?

    #[account(
        mut,
        constraint = initializer_deposit_token_account.amount >= initializer_amount
    )]
    pub initializer_deposit_token_account: Account<'info, TokenAccount>,
    pub initializer_receive_token_account: Account<'info, TokenAccount>,
    #[account(zero)]
    //QS: Sets discriminator to zero, which is a 8-byte unique identifier for a Type. Meaning?
    pub escrow_account: ProgramAccount<'info, EscrowAccount>,
    //escrow_account will deserialize into EscrowAccount struct below
    pub system_program: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: AccountInfo<'info>,

}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(mut, signer)]
    pub initializer: AccountInfo<'info>,
    #[account(mut)]
    pub vault_account: Account<'info, TokenAccount>,
    pub vault_authority: AccountInfo<'info>,
    #[account(mut)]
    pub initializer_deposit_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = escrow_account.initializer_key == *initializer.key,
        constraint =
            escrow_account.initializer_deposit_token_account ==
            *initializer_deposit_token_account.to_account_info().key,
            //NTS: I see why this is here but potential bug possible if initializer migrated token
            //      acounts after inititalizing right?
        close = initializer
    )]
    pub escrow_account: ProgramAccount<'info, EscrowAccount>,
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Exchange<'info> {
    #[account(signer)]
    pub taker: AccountInfo<'info>,
    #[account(mut)]
    pub taker_deposit_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub taker_receive_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub initializer_deposit_token_account: Account<'info, TokenAccount>,
    //QS: same potential migration bug?
    #[account(mut)]
    pub initializer_receive_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub initializer: AccountInfo<'info>,
    #[account(
        mut,
        constraint = escrow_account.taker_amount <= taker_deposit_token_account.amount,
        constraint =
            escrow_account.initializer_deposit_token_account ==
            *initializer_deposit_token_account.to_account_info().key,
        constraint =
            escrow_account.initializer_receive_token_account ==
            *initializer_receive_token_account.to_account_info().key,
        constraint = escrow_account.initializer_key == *initializer.key,
        close = initializer
    )]
    pub escrow_account: ProgramAccount<'info, EscrowAccount>,
    #[account(mut)]
    pub vault_account: Account<'info, TokenAccount>,
    pub vault_authority: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
}

#[account]
pub struct EscrowAccount{
    pub initializer_key: Pubkey,
    pub initializer_deposit_token_account: Pubkey,
    pub initializer_receive_token_account: Pubkey,
    pub initializer_amount: u64,
    pub taker_amount: u64,
}

impl <'info> InitializeEscrow<'info> {

    fn into_set_authority_context(&self) -> CpiContext<'_, '_, '_, 'info, SetAuthority<'info>> {
        let cpi_accounts = SetAuthority {
            account_or_mint: self.vault_account.to_account_info().clone(),
            current_authority: self.initializer.clone(),
        };
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }

    fn into_transfer_to_pda_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.initializer_deposit_token_account.to_account_info().clone(),
            to: self.vault_account.to_account_info().clone(),
            authority: self.initializer.clone(),
        };
        CpiContext::new(self.token_program.clone(), cpi_accounts)
    }
    //NTS: Above function creates a cpi of token::Transfer and transfers deposit tokens from wallet
    //     token account to vault deposit token account. cpi_accounts is more like instructions+
    //     accounts
    //QS: Do we not need to create a token account for vault_account to hold the deposited tokens?
    //A: Vault account is already a token account so no need?

}

impl <'info> CancelEscrow<'info> {
    fn into_transfer_to_initializer_context(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.vault_account.to_account_info().clone(),
            to: self.initializer_deposit_token_account.to_account_info().clone(),
            //NTS: same potential problem with migration as before right?
            authority: self.vault_authority.clone(),
        };

        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }

    fn into_close_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self.vault_account.to_account_info().clone(),
            destination: self.initializer.clone(),
            authority: self.vault_authority.clone(),
        };
        //QS: What's happening under hood here? Why destination for close account?
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

impl <'info> Exchange<'info> {
    fn into_transfer_to_initializer_context(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.taker_deposit_token_account.to_account_info().clone(),
            to: self.initializer_receive_token_account.to_account_info().clone(),
            authority: self.taker.clone(),
        };
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }

    fn into_transfer_to_taker_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.vault_account.to_account_info().clone(),
            to: self.taker_receive_token_account.to_account_info().clone(),
            authority: self.vault_authority.clone(),
        };
        CpiContext::new(self.token_program.clone(), cpi_accounts)
        //QS: Why do some cpi's take token_program.clone and others token_program.to_account_info?
        //      token_program is already an AccountInfo struct so latter is not necessary right?
    }

    fn into_close_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self.vault_account.to_account_info().clone(),
            destination: self.initializer.clone(),
            authority: self.vault_authority.clone(),
        };
        CpiContext::new(self.token_program.clone(), cpi_accounts)
    }
}
