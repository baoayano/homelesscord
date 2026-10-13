/* SPDX-License-Identifier: AGPL-3.0-only */

export class AutomodSlurConfiguration {
    enabled: boolean = true;
    includeSoftA: boolean = false;
    suspendDays: number = 7;
    deleteAllMessages: boolean = true;
    violationDays: number = 90;
    actOnVerifiedReports: boolean = true;
}

export type AutomodWordListAction = "delete" | "suspend" | "name";

export interface AutomodWordList {
    id: string;
    name: string;
    terms: string[];
    action: AutomodWordListAction;
    suspendDays: number;
}

export class AutomodRegistrationConfiguration {
    maxAccountsPerIpPerDay: number = 0;
    maxAccountsPerIp: number = 0;
}

export class AutomodLoginConfiguration {
    maxFailedAttemptsPerAccount: number = 10;
    lockoutMinutes: number = 15;
    maxAccountsPerIp: number = 0;
    sessionActiveDays: number = 30;
}

export type AutomodSpamAction = "log" | "delete" | "timeout" | "suspend" | "disable";

export class AutomodSpamEveryoneConfiguration {
    enabled: boolean = true;
    action: AutomodSpamAction = "timeout";
    windowSeconds: number = 600;
    unpermittedLimit: number = 2;
    permittedLimit: number = 4;
    exemptAccountAgeDays: number = 0;
}

export class AutomodSpamMentionConfiguration {
    enabled: boolean = true;
    action: AutomodSpamAction = "timeout";
    messageLimit: number = 10;
    windowLimit: number = 20;
    windowSeconds: number = 60;
    exemptAccountAgeDays: number = 0;
}

export class AutomodSpamFloodConfiguration {
    enabled: boolean = true;
    action: AutomodSpamAction = "timeout";
    messageLimit: number = 15;
    windowSeconds: number = 10;
    channelLimit: number = 5;
    channelWindowSeconds: number = 30;
    exemptAccountAgeDays: number = 0;
}

export class AutomodSpamDuplicateConfiguration {
    enabled: boolean = true;
    action: AutomodSpamAction = "delete";
    minLength: number = 30;
    windowSeconds: number = 120;
    channelLimit: number = 3;
    accountLimit: number = 5;
    exemptAccountAgeDays: number = 0;
}

export class AutomodSpamLinkConfiguration {
    enabled: boolean = true;
    action: AutomodSpamAction = "delete";
    inviteLimit: number = 2;
    linkLimit: number = 4;
    windowSeconds: number = 300;
    exemptAccountAgeDays: number = 7;
}

export class AutomodSpamBurstConfiguration {
    enabled: boolean = true;
    action: AutomodSpamAction = "suspend";
    accountLimit: number = 4;
    minLength: number = 10;
    windowSeconds: number = 300;
    exemptAccountAgeDays: number = 1;
}

export class AutomodSpamAttachmentConfiguration {
    enabled: boolean = true;
    action: AutomodSpamAction = "delete";
    channelLimit: number = 3;
    accountLimit: number = 3;
    minBytes: number = 256;
    windowSeconds: number = 600;
    exemptAccountAgeDays: number = 7;
}

export class AutomodSpamDmConfiguration {
    enabled: boolean = true;
    action: AutomodSpamAction = "timeout";
    openLimit: number = 10;
    friendRequestLimit: number = 10;
    sameContentLimit: number = 4;
    minLength: number = 8;
    windowSeconds: number = 600;
    exemptAccountAgeDays: number = 0;
    newAccountHours: number = 72;
    newAccountDmsPerHour: number = 5;
}

export class AutomodSpamConfiguration {
    everyone: AutomodSpamEveryoneConfiguration = new AutomodSpamEveryoneConfiguration();
    mentions: AutomodSpamMentionConfiguration = new AutomodSpamMentionConfiguration();
    flood: AutomodSpamFloodConfiguration = new AutomodSpamFloodConfiguration();
    duplicates: AutomodSpamDuplicateConfiguration = new AutomodSpamDuplicateConfiguration();
    links: AutomodSpamLinkConfiguration = new AutomodSpamLinkConfiguration();
    burst: AutomodSpamBurstConfiguration = new AutomodSpamBurstConfiguration();
    attachments: AutomodSpamAttachmentConfiguration = new AutomodSpamAttachmentConfiguration();
    dms: AutomodSpamDmConfiguration = new AutomodSpamDmConfiguration();
    timeoutMinutes: number = 60;
    suspendHours: number = 24;
    escalateAfterStrikes: number = 3;
    strikeWindowHours: number = 24;
}

export class AutomodScamConfiguration {
    enabled: boolean = true;
    action: AutomodSpamAction = "delete";
    lookalikes: boolean = true;
    giftBait: boolean = true;
    qrLogin: boolean = true;
    ipLoggers: boolean = true;
    shortenerAccountAgeDays: number = 7;
    extraDomains: string[] = [];
    allowDomains: string[] = [];
    remoteListUrl: string = "";
    remoteListRefreshMinutes: number = 360;
}

export class AutomodSignupConfiguration {
    enabled: boolean = true;
    logScore: number = 20;
    holdScore: number = 60;
    refuseScore: number = 0;
    windowMinutes: number = 30;
    disposableEmailWeight: number = 40;
    similarNameWeight: number = 30;
    similarNameLimit: number = 3;
    samePasswordWeight: number = 30;
    samePasswordLimit: number = 2;
    fastCaptchaWeight: number = 25;
    fastCaptchaMs: number = 1500;
    deniedEmailDomains: string[] = [];
    allowedEmailDomains: string[] = [];
}

export class AutomodQuarantineConfiguration {
    enabled: boolean = false;
    hours: number = 24;
    allowLinks: boolean = false;
    allowAttachments: boolean = false;
    allowEmbeds: boolean = false;
    maxMentions: number = 2;
    maxDms: number = 3;
}

export class AutomodVerificationConfiguration {
    enforce: boolean = true;
    requirePhoneForHighest: boolean = false;
}

export class AutomodExplicitContentConfiguration {
    enabled: boolean = true;
    flagAllMedia: boolean = false;
    terms: string[] = ["nsfw", "porn", "porno", "xxx", "hentai", "nude", "nudes", "onlyfans", "r34", "rule34", "gore"];
    blockedHashes: string[] = [];
}

export class AutomodFederationConfiguration {
    reportToHome: boolean = true;
    acceptReports: boolean = true;
    reportsPerHourPerInstance: number = 120;
}

export class AutomodConfiguration {
    slurs: AutomodSlurConfiguration = new AutomodSlurConfiguration();
    wordLists: AutomodWordList[] = [];
    allowList: string[] = [];
    ipAllowList: string[] = [];
    registration: AutomodRegistrationConfiguration = new AutomodRegistrationConfiguration();
    login: AutomodLoginConfiguration = new AutomodLoginConfiguration();
    spam: AutomodSpamConfiguration = new AutomodSpamConfiguration();
    scam: AutomodScamConfiguration = new AutomodScamConfiguration();
    signup: AutomodSignupConfiguration = new AutomodSignupConfiguration();
    quarantine: AutomodQuarantineConfiguration = new AutomodQuarantineConfiguration();
    verification: AutomodVerificationConfiguration = new AutomodVerificationConfiguration();
    explicitContent: AutomodExplicitContentConfiguration = new AutomodExplicitContentConfiguration();
    federation: AutomodFederationConfiguration = new AutomodFederationConfiguration();
}
