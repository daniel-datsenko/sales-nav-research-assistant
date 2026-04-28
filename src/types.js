/**
 * Shared JSDoc types for the LinkedIn Sales Navigator automation platform.
 *
 * @typedef {Object} TerritoryRunSpec
 * @property {string} runId
 * @property {string} territoryId
 * @property {string} territoryName
 * @property {string} snapshotId
 * @property {string} driver
 * @property {string} icpConfigPath
 * @property {string} searchTemplatesPath
 * @property {string | null} [modeId]
 * @property {string | null} [personaModesPath]
 * @property {boolean} subsidiaryExpansion
 * @property {boolean} dryRun
 * @property {number} weeklyCap
 * @property {string} [sourceType]
 * @property {string} [sourceRef]
 * @property {string} [runtimeMode]
 * @property {string} createdAt
 *
 * @typedef {Object} SalesforceTerritorySnapshot
 * @property {string} snapshotId
 * @property {Object} territory
 * @property {Object[]} accounts
 * @property {string} sourceType
 * @property {string} sourceRef
 * @property {string} syncedAt
 *
 * @typedef {Object} AccountGraphNode
 * @property {string} accountId
 * @property {string} name
 * @property {string} [website]
 * @property {string} [country]
 * @property {string} [region]
 * @property {string|null} [parentAccountId]
 * @property {number} [priority]
 * @property {Object} [salesNav]
 * @property {Object} [signals]
 * @property {boolean} [isSubsidiary]
 *
 * @typedef {Object} SearchTemplate
 * @property {string} id
 * @property {string} name
 * @property {string[]} [keywords]
 * @property {string[]} [titleIncludes]
 * @property {string[]} [titleExcludes]
 * @property {string[]} [seniorityTargets]
 * @property {number} [maxCandidates]
 * @property {number} [minimumRelevantHits]
 * @property {string} [listSegment]
 *
 * @typedef {Object} CandidateRecord
 * @property {string} candidateId
 * @property {string} runId
 * @property {string} accountKey
 * @property {string} fullName
 * @property {string} title
 * @property {string} [company]
 * @property {string} [headline]
 * @property {string} [location]
 * @property {string} [profileUrl]
 * @property {string} [salesNavigatorUrl]
 * @property {number} score
 * @property {Object} scoreBreakdown
 * @property {Object} evidence
 * @property {string} recommendation
 * @property {string} listName
 * @property {string} [listSaveStatus]
 *
 * @typedef {Object} ApprovalItem
 * @property {string} approvalId
 * @property {string} candidateId
 * @property {string} runId
 * @property {string} state
 * @property {string|null} reviewerNote
 *
 * @typedef {Object} ConnectBudgetState
 * @property {number} weeklyCap
 * @property {number} sentThisWeek
 * @property {number} remainingThisWeek
 * @property {number} sentToday
 * @property {number} recommendedTodayLimit
 * @property {number} remainingToday
 *
 * @typedef {Object} RecoveryEvent
 * @property {string} recoveryId
 * @property {string} runId
 * @property {string} severity
 * @property {string} eventType
 * @property {Object} details
 *
 * @typedef {Object} RunCheckpoint
 * @property {string} runId
 * @property {number} accountIndex
 * @property {string|null} currentAccountKey
 * @property {string|null} lastTemplateId
 * @property {string} updatedAt
 *
 * @typedef {Object} PriorityRoleFamilyScore
 * @property {string} roleFamily
 * @property {number} historicalWinRate
 * @property {number} historicalAmountWeight
 * @property {number} hiddenInfluencerPresence
 * @property {number} conversation_intelligenceKeywordFit
 * @property {number} roleCoverageFit
 * @property {number} priorityScore
 *
 * @typedef {Object} PriorityModelV1
 * @property {string} modelId
 * @property {string} version
 * @property {string} builtAt
 * @property {Object} summary
 * @property {PriorityRoleFamilyScore[]} roleFamilyScores
 * @property {Object[]} hiddenInfluencerSignals
 * @property {Object[]} conversation_intelligenceSignals
 * @property {Object} buyerGroupRoles
 * @property {Object} scoreBands
 *
 * @typedef {Object} DriverAdapter
 * @property {(context: Object) => Promise<void>} openSession
 * @property {(context: Object) => Promise<void>} openAccountSearch
 * @property {(accounts: AccountGraphNode[], context: Object) => Promise<AccountGraphNode[]>} enumerateAccounts
 * @property {(account: AccountGraphNode, context: Object) => Promise<void>} openAccount
 * @property {(account: AccountGraphNode, context: Object) => Promise<void>} openPeopleSearch
 * @property {(template: SearchTemplate, context: Object) => Promise<void>} applySearchTemplate
 * @property {(account: AccountGraphNode, template: SearchTemplate, context: Object) => Promise<Object[]>} scrollAndCollectCandidates
 * @property {(accountName: string, context: Object) => Promise<Object|null>} resolveCompanyAlias
 * @property {(candidate: Object, context: Object) => Promise<void>} openCandidate
 * @property {(listName: string, context: Object) => Promise<Object>} ensureList
 * @property {(candidate: Object, listInfo: Object, context: Object) => Promise<Object>} saveCandidateToList
 * @property {(candidate: Object, context: Object) => Promise<Object>} sendConnect
 * @property {(candidate: Object, context: Object) => Promise<Object>} captureEvidence
 * @property {(event: Object, context: Object) => Promise<Object>} recoverFromInterruption
 * @property {() => Promise<void>} close
 */

module.exports = {};
