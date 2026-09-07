# Legal and Compliance Review

> Research checklist dated 2026-08-16. This is not legal advice and is not final
> website copy. A qualified attorney must review the exact company, code,
> transaction flow, launch locations, marketing, terms, and fee arrangement
> before commercial mainnet release.

## The central principle

“We are only a UI,” “DeFi,” “not a bank,” and “not responsible” are descriptions
or disclaimers, not automatic legal exemptions. The strongest position comes
from making the product genuinely non-custodial and accurately describing what
it does. Terms can allocate some risks but cannot erase non-waivable laws or
make misleading product claims accurate.

## Architecture facts counsel should be able to verify

- The operator never possesses or controls protected assets.
- The operator never receives user signing keys.
- Transaction construction occurs locally and the user's wallet signs.
- The operator cannot pulse, close, change, freeze, redirect, upgrade, or recover
  any vault.
- The validator is open source and independently usable without the website.
- The validator imposes no operator fee.
- The website adds a disclosed 5 ADA payment for its own setup-interface service.
- The fee and vault creation succeed or fail in one atomic transaction.
- There is no exchange, swap, lending, yield, investment management, hosted
  wallet, pooled account, or promise to transmit assets on the user's behalf.
- The site does not advertise a vault as a legally valid will, trust, probate
  substitute, insured deposit, or guaranteed inheritance transfer.

Changing any of those facts triggers a new legal review.

## U.S. federal money-transmission analysis

FinCEN states that producing and distributing software, by itself, does not
constitute acceptance and transmission of value. It also says treatment depends
on the actual facts and circumstances, and that owners/operators of a DApp can
be money transmitters when the DApp accepts and transmits value. The legal review
therefore must analyze the complete fee-bearing transaction and operator role,
not rely on the labels “software” or “decentralized.”

Design implications:

- never take custody or independent control;
- never accept protected value into an operator-controlled address before
  forwarding it;
- receive only the clearly identified payment for the operator's own service;
- avoid server-side signing, hosted recovery, discretionary execution, swaps,
  or operator-selected recipients; and
- obtain a written legal analysis before launch, including whether any FinCEN
  registration, BSA/AML program, recordkeeping, or reporting duty applies.

Primary sources:

- FinCEN, [Application of FinCEN's Regulations to Certain Business Models
  Involving Convertible Virtual Currencies](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-certain-business-models)
- FinCEN, [Virtual Currency Software Development and Certain Investment
  Activity](https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/application-fincens-regulations-virtual)

## State money-transmission and virtual-currency laws

State treatment varies and can change independently of federal analysis. Counsel
must review the operator's home state and every state in which the service is
offered. This includes whether merely constructing a transaction, receiving the
site fee in the same transaction, or operating a public front end falls within a
license, exclusion, or exemption.

For example, Illinois replaced its prior Transmitters of Money Act with the
Uniform Money Transmission Modernization Act effective January 1, 2026. The
current act defines money transmission and monetary value, excludes solely
providing online/network access, and gives the state regulator interpretive
authority. That text requires fact-specific counsel review; it is not safe to
reuse older virtual-currency guidance as a blanket conclusion.

Primary source:

- Illinois General Assembly, [Uniform Money Transmission Modernization
  Act](https://www.ilga.gov/legislation/ILCS/details?ActID=4549&ActName=Uniform+Money+Transmission+Modernization+Act.&ChapAct=FullText&Chapter=FINANCIAL+REGULATION&ChapterID=20&MajorTopic=REGULATION&SeqStart=)

## Sanctions

OFAC says sanctions obligations apply to virtual-currency transactions as they
do to fiat transactions and specifically addresses technology companies, wallet
providers, and users. Counsel should design a risk-based sanctions policy for
the site, operator fee address, supported locations, and any later monitoring or
storage service. A terms clause or blockchain's permissionless nature is not a
complete sanctions program.

Primary source:

- OFAC, [Sanctions Compliance Guidance for the Virtual Currency
  Industry](https://ofac.treasury.gov/system/files/126/virtual_currency_guidance_brochure.pdf)

## Consumer protection and marketing

The site must describe the mechanism accurately. The FTC says required online
disclosures must be clear and conspicuous; buried fine print cannot contradict a
broader misleading claim. Therefore the fee, lack of custody, lack of insurance,
possibility of release while the user is alive, transaction irreversibility,
need for a third-party release transaction, and smart-contract risk must appear
near the creation/review actions.

Avoid claims such as:

- “automatic inheritance”;
- “guaranteed delivery”;
- “proof that you died”;
- “insured,” “risk free,” or “bank-grade” without substantiation;
- “we manage your vault”; or
- “legally replaces a will.”

Primary sources:

- FTC, [Advertising FAQs for Small
  Business](https://www.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business)
- FTC, [Online Advertising and
  Marketing](https://www.ftc.gov/business-guidance/advertising-marketing/online-advertising-marketing)

## Bank and insurance representations

The product is not an account at an FDIC-insured institution, and crypto assets
are not FDIC-insured deposits. Do not use the FDIC name/logo except in accurate,
attorney-reviewed explanatory text, and do not imply that the operator, wallet,
validator, or a partner bank insures the vault.

Primary source:

- FDIC, [Deposit Insurance and Dealings with Crypto
  Companies](https://www.fdic.gov/news/financial-institution-letters/2022/fil22035.html)

## Estate, probate, property, and tax

A transfer enforced by a validator may still interact with a will, trust,
probate estate, marital or community property rights, creditors, fiduciary
duties, incapacity rules, fraudulent-transfer law, and tax reporting. A missed
pulse can also transfer assets while the owner is alive, so the product cannot
assume every release is an inheritance.

The site should require users to acknowledge that it is not an estate-planning
document and recommend coordinating the vault with a qualified estate attorney.
The recovery manifest is technical evidence, not a will. The IRS expressly
includes digital assets in estate reporting materials and separately requires
records for digital-asset tax positions.

Representative sources:

- Uniform Law Commission, [Revised Uniform Fiduciary Access to Digital Assets
  overview](https://www.uniformlaws.org/aboutulc/faq)
- IRS, [Instructions for Form 706](https://www.irs.gov/instructions/i706)
- IRS, [Digital assets](https://www.irs.gov/filing/digital-assets)

## Privacy and data security

Even a public wallet address can become personal data when linked to an IP
address, email, analytics identifier, or support record. The first site should
avoid accounts, advertising trackers, and unnecessary telemetry. Counsel must
review the Privacy Notice, cookie/analytics behavior, service providers,
retention, breach response, cross-border availability, and applicable state or
international privacy laws.

The site must explicitly explain that blockchain transaction data, vault value,
deadlines, and release policies are publicly observable and generally cannot be
deleted.

## Documents required before commercial launch

Attorney-reviewed documents should include:

- Terms of Use;
- Privacy Notice;
- Risk Disclosure;
- Fee Disclosure and refund/failure treatment;
- sanctions and prohibited-use policy;
- supported/prohibited jurisdiction policy;
- open-source license notices;
- vulnerability disclosure policy; and
- a written regulatory memorandum covering federal and state money-transmission
  analysis for the exact architecture.

The company should also review entity formation, accounting and tax treatment of
ADA fee revenue, record retention, cyber/error-and-omissions insurance, incident
response, and a contact process for legal requests.

## Launch blockers

Commercial mainnet launch is blocked if any are true:

- the operator can access protected assets or user keys;
- fee language is hidden, ambiguous, or inconsistent with the transaction;
- the legal pages are generic generated text without jurisdiction-specific
  review;
- marketing suggests death verification, guaranteed inheritance, custody,
  insurance, or legal effectiveness;
- the supported-jurisdiction and sanctions decisions are unresolved;
- the fee flow or any later service has changed since counsel's analysis; or
- security review and testnet evidence are incomplete.
