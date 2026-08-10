import type { Domain, Registry } from './types.ts';

/**
 * Seed registry.
 *
 * Domain membership follows the archetype definitions in Appendix B §B.3, and the set is
 * sized to convene the three worked panels in §B.2.5 exactly. All six archetypes are
 * represented: seeding from one archetype "builds a spine that later stages must fight"
 * (§C.8 stage 1), and the golden scenario tests would not catch it if every fixture shared
 * that archetype.
 *
 * Relevance predicates are deliberately narrow. §C.4 step six: "a domain registered against
 * everything will always be convened, which reintroduces a spine through the back door."
 * Predicates should be specific enough that some scenarios genuinely exclude the domain,
 * and the convening tests assert exactly that.
 *
 * Lives in TypeScript rather than SQL so `core` tests need no database. `cli seed:registry`
 * writes it to Postgres.
 */

const d = (domain: Domain): Domain => domain;

// ---------------------------------------------------------------------------------------
// Latent-Physical. Effect deferred and conditional on operating environment; adversarial
// action frequently indistinguishable from quality escape; verification sampled and often
// destructive; mitigation windows close hard, usually at installation.
// ---------------------------------------------------------------------------------------

const LATENT_PHYSICAL: Domain[] = [
  d({
    id: 'materials.polymers_adhesives',
    displayName: 'Polymers and Adhesives',
    archetype: 'latent_physical',
    parentDomain: 'materials',
    scopeInclusions: ['adhesive_bonding', 'polymer_matrix_composites', 'surface_preparation'],
    scopeExclusions: [{ topic: 'metallic_fastening', routeTo: 'materials.metallurgy' }],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'bonded_primary_structure', weight: 2 },
      { kind: 'subject_characteristic', value: 'composite_material', weight: 2 },
      { kind: 'consequence_class', value: 'physical_failure_in_service', weight: 1 },
    ],
  }),
  d({
    id: 'materials.metallurgy',
    displayName: 'Metallurgy',
    archetype: 'latent_physical',
    parentDomain: 'materials',
    scopeInclusions: ['alloy_composition', 'heat_treatment', 'metallic_fastening'],
    scopeExclusions: [{ topic: 'polymer_matrix_composites', routeTo: 'materials.polymers_adhesives' }],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'metallic_structure', weight: 2 },
      { kind: 'subject_characteristic', value: 'controlled_process', weight: 1 },
      { kind: 'consequence_class', value: 'physical_failure_in_service', weight: 1 },
    ],
  }),
  d({
    id: 'materials.process_chemistry',
    displayName: 'Process Chemistry',
    archetype: 'latent_physical',
    parentDomain: 'materials',
    scopeInclusions: ['bath_chemistry', 'cure_cycles', 'surface_treatment'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'controlled_process', weight: 2 },
      { kind: 'subject_characteristic', value: 'composite_material', weight: 1 },
      { kind: 'consequence_class', value: 'physical_failure_in_service', weight: 1 },
    ],
  }),
  d({
    id: 'structures',
    displayName: 'Structures',
    archetype: 'latent_physical',
    scopeInclusions: ['load_paths', 'damage_tolerance', 'static_and_fatigue_substantiation'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'bonded_primary_structure', weight: 2 },
      { kind: 'subject_characteristic', value: 'metallic_structure', weight: 1 },
      { kind: 'consequence_class', value: 'physical_failure_in_service', weight: 1 },
      { kind: 'consequence_class', value: 'safety_event', weight: 1 },
    ],
  }),
  d({
    id: 'analytical_detection_design',
    displayName: 'Analytical and Detection Design',
    archetype: 'latent_physical',
    scopeInclusions: ['nde_method_selection', 'sampling_plans', 'detection_sensitivity'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    // Appendix C §C.2.6: forcing honesty about sampling rate and false negative rate is
    // this persona's central contribution. "We tested the lot and found nothing" is not a
    // finding, and the charter validator rejects it as one.
    predicates: [
      { kind: 'consequence_class', value: 'physical_failure_in_service', weight: 1 },
      { kind: 'consequence_class', value: 'safety_event', weight: 1 },
      { kind: 'subject_characteristic', value: 'controlled_process', weight: 1 },
      { kind: 'subject_characteristic', value: 'composite_material', weight: 1 },
    ],
  }),
  d({
    id: 'logistics_storage',
    displayName: 'Logistics and Storage Conditions',
    archetype: 'latent_physical',
    scopeInclusions: ['shelf_life_control', 'cold_chain', 'handling_damage'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'shelf_life_sensitive', weight: 2 },
      { kind: 'consequence_class', value: 'physical_failure_in_service', weight: 1 },
    ],
  }),
  d({
    id: 'spectrum_emissions',
    displayName: 'Spectrum and Emissions',
    archetype: 'latent_physical',
    scopeInclusions: ['unintentional_emissions', 'rf_susceptibility', 'emission_control'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'electronic_emission', weight: 2 },
      { kind: 'consequence_class', value: 'information_compromise', weight: 1 },
      { kind: 'consequence_class', value: 'mission_unavailability', weight: 1 },
    ],
  }),
  d({
    id: 'supply_chain.authenticity',
    displayName: 'Supply Chain: Component Authenticity',
    archetype: 'latent_physical',
    parentDomain: 'supply_chain',
    scopeInclusions: ['counterfeit_detection', 'destructive_verification', 'lot_traceability'],
    scopeExclusions: [
      { topic: 'certificate_interpretation', routeTo: 'supply_chain.provenance' },
      { topic: 'vendor_ownership', routeTo: 'supply_chain.vendor_intent' },
    ],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'purchased_electronic_component', weight: 2 },
      { kind: 'subject_characteristic', value: 'long_provenance_chain', weight: 2 },
    ],
  }),
];

// ---------------------------------------------------------------------------------------
// Immediate-Observable. Effect follows cause in minutes to months; verification repeatable
// and can approach comprehensive; evidence directly queryable.
// ---------------------------------------------------------------------------------------

const IMMEDIATE_OBSERVABLE: Domain[] = [
  d({
    id: 'network_systems_architecture',
    displayName: 'Network and Systems Architecture',
    archetype: 'immediate_observable',
    scopeInclusions: ['segmentation', 'identity_and_access', 'interface_exposure'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'networked_system', weight: 2 },
      { kind: 'subject_characteristic', value: 'fielded_software', weight: 1 },
      { kind: 'consequence_class', value: 'information_compromise', weight: 2 },
      { kind: 'consequence_class', value: 'mission_unavailability', weight: 2 },
    ],
  }),
  d({
    id: 'detection_engineering',
    displayName: 'Detection Engineering',
    archetype: 'immediate_observable',
    scopeInclusions: ['telemetry_coverage', 'detection_logic', 'alert_triage'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'consequence_class', value: 'information_compromise', weight: 2 },
      { kind: 'consequence_class', value: 'mission_unavailability', weight: 1 },
      { kind: 'subject_characteristic', value: 'networked_system', weight: 1 },
    ],
  }),
  d({
    id: 'digital_thread_integrity',
    displayName: 'Digital Thread Integrity',
    archetype: 'immediate_observable',
    scopeInclusions: ['build_records', 'cure_records', 'model_based_definition'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    // Narrow on purpose. Registering this against information_compromise would convene it
    // in every information scenario, and §B.2.5 Scenario 3 does not include it.
    predicates: [
      { kind: 'subject_characteristic', value: 'digital_build_records', weight: 1 },
      { kind: 'subject_characteristic', value: 'model_based_definition', weight: 2 },
    ],
  }),
];

// ---------------------------------------------------------------------------------------
// Attributive-Contested. Evidence behavioral and ambiguous; benign explanations usually
// available and usually correct; base rates unfavorable; essentially no feedback loop.
// ---------------------------------------------------------------------------------------

const ATTRIBUTIVE_CONTESTED: Domain[] = [
  d({
    id: 'insider_threat',
    displayName: 'Insider Threat',
    archetype: 'attributive_contested',
    scopeInclusions: ['access_risk', 'behavioral_indicator_classes', 'privileged_role_exposure'],
    // Appendix C §C.3.4 and §C.3.2: insider threat assesses risk that someone acts,
    // counterintelligence assesses risk that someone is targeted. Different questions,
    // different indicators, routinely confused — so the deconfliction is explicit.
    scopeExclusions: [
      { topic: 'adversary_targeting_of_personnel', routeTo: 'counterintelligence' },
      { topic: 'named_individual_determination', routeTo: 'human:program_ci_authority' },
    ],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'cleared_personnel_privileged_access', weight: 2 },
      { kind: 'consequence_class', value: 'information_compromise', weight: 2 },
    ],
  }),
  d({
    id: 'counterintelligence',
    displayName: 'Counterintelligence',
    archetype: 'attributive_contested',
    scopeInclusions: [
      'collection_surface',
      'adversary_collection_requirements',
      'approach_and_elicitation_vectors',
      'assessment_as_target',
    ],
    // The hard exclusion (§C.3.4). Not optional: "A CI persona that profiles named
    // individuals has become a surveillance instrument, and no analytical benefit
    // justifies it inside this construct." Routing terminates rather than advises, and the
    // charter validator enforces it at the output boundary (CH010).
    scopeExclusions: [
      { topic: 'named_individual_determination', routeTo: 'human:program_ci_authority' },
      { topic: 'personnel_adjudication', routeTo: 'human:program_ci_authority' },
    ],
    status: 'registered',
    // Reflexive: takes the program's own posture and the assessment process itself as its
    // object, with cross-domain read scope. This is the documented exception to the
    // independence rule in §B.7.1, granted because CI analyzes the aggregate rather than
    // contributing to it. Gated on this field, not on a hardcoded set of domain ids.
    personaClass: 'reflexive',
    predicates: [
      { kind: 'consequence_class', value: 'adversary_capability_advantage', weight: 2 },
      { kind: 'consequence_class', value: 'decision_corruption', weight: 1 },
      { kind: 'subject_characteristic', value: 'cleared_personnel_privileged_access', weight: 2 },
      { kind: 'subject_characteristic', value: 'foreign_ownership_influence', weight: 1 },
    ],
  }),
  d({
    id: 'information_environment',
    displayName: 'Information Environment',
    archetype: 'attributive_contested',
    scopeInclusions: ['narrative_exposure', 'disclosure_aggregation', 'influence_vectors'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'public_program_profile', weight: 2 },
      { kind: 'consequence_class', value: 'decision_corruption', weight: 2 },
    ],
  }),
  d({
    id: 'supply_chain.vendor_intent',
    displayName: 'Supply Chain: Vendor Intent and Ownership',
    archetype: 'attributive_contested',
    parentDomain: 'supply_chain',
    scopeInclusions: ['beneficial_ownership', 'vendor_behavior_patterns', 'supplier_coercion_exposure'],
    scopeExclusions: [
      { topic: 'certificate_interpretation', routeTo: 'supply_chain.provenance' },
      { topic: 'counterfeit_detection', routeTo: 'supply_chain.authenticity' },
    ],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'sole_source_dependency', weight: 2 },
      { kind: 'subject_characteristic', value: 'foreign_ownership_influence', weight: 2 },
      { kind: 'consequence_class', value: 'adversary_capability_advantage', weight: 1 },
      { kind: 'consequence_class', value: 'program_disruption', weight: 1 },
    ],
  }),
];

// ---------------------------------------------------------------------------------------
// Procedural-Interpretive. Evidence is authoritative documentary text; verification is
// interpretation rather than measurement; the adversary exploits process rather than physics.
// ---------------------------------------------------------------------------------------

const PROCEDURAL_INTERPRETIVE: Domain[] = [
  d({
    id: 'supply_chain.provenance',
    displayName: 'Supply Chain: Provenance and Certificate Integrity',
    archetype: 'procedural_interpretive',
    parentDomain: 'supply_chain',
    scopeInclusions: ['certificate_interpretation', 'custody_transfers', 'mill_and_lot_records'],
    scopeExclusions: [
      { topic: 'vendor_ownership', routeTo: 'supply_chain.vendor_intent' },
      { topic: 'counterfeit_detection', routeTo: 'supply_chain.authenticity' },
    ],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'foreign_jurisdiction_supplier', weight: 2 },
      { kind: 'subject_characteristic', value: 'long_provenance_chain', weight: 2 },
      { kind: 'subject_characteristic', value: 'certificate_dependent_acceptance', weight: 2 },
    ],
  }),
  d({
    id: 'legal.legal_regulatory',
    displayName: 'Legal and Regulatory',
    archetype: 'procedural_interpretive',
    parentDomain: 'legal',
    scopeInclusions: ['audit_rights', 'regulatory_obligation', 'liability_exposure'],
    // The specialized procedural domains own their own exposure. Without these exclusions
    // this domain would displace them in exactly the scenarios they exist for.
    scopeExclusions: [
      { topic: 'foreign_technology_transfer', routeTo: 'legal.export_control' },
      { topic: 'acquisition_and_contracting', routeTo: 'legal.contracting_acquisition' },
    ],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'foreign_jurisdiction_supplier', weight: 1 },
      { kind: 'subject_characteristic', value: 'classified_information_handling', weight: 1 },
      { kind: 'subject_characteristic', value: 'regulated_product', weight: 2 },
    ],
  }),
  d({
    id: 'legal.export_control',
    displayName: 'Export Control',
    archetype: 'procedural_interpretive',
    parentDomain: 'legal',
    scopeInclusions: ['technology_transfer', 'licensing', 'deemed_export'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'foreign_technology_transfer', weight: 2 },
      { kind: 'consequence_class', value: 'legal_exposure', weight: 2 },
    ],
  }),
  d({
    id: 'legal.contracting_acquisition',
    displayName: 'Contracting and Acquisition',
    archetype: 'procedural_interpretive',
    parentDomain: 'legal',
    scopeInclusions: ['acquisition_and_contracting', 'competition_strategy', 'data_rights'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'sole_source_dependency', weight: 2 },
      { kind: 'consequence_class', value: 'program_disruption', weight: 2 },
      { kind: 'consequence_class', value: 'legal_exposure', weight: 1 },
    ],
  }),
];

// ---------------------------------------------------------------------------------------
// Anticipatory-Unvalidated. Long horizon, no usable feedback loop. The value is framing
// rather than prediction: it tells other domains which adversaries to model.
// ---------------------------------------------------------------------------------------

const ANTICIPATORY_UNVALIDATED: Domain[] = [
  d({
    id: 'geopolitical',
    displayName: 'Geopolitical and Intelligence',
    archetype: 'anticipatory_unvalidated',
    scopeInclusions: ['state_actor_posture', 'jurisdictional_risk', 'coercion_leverage'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'foreign_ownership_influence', weight: 2 },
      { kind: 'subject_characteristic', value: 'sole_source_dependency', weight: 2 },
      { kind: 'consequence_class', value: 'adversary_capability_advantage', weight: 2 },
      { kind: 'consequence_class', value: 'decision_corruption', weight: 2 },
      { kind: 'consequence_class', value: 'program_disruption', weight: 1 },
    ],
  }),
  d({
    id: 'economic_supplier_financial',
    displayName: 'Economic and Supplier Financial',
    archetype: 'anticipatory_unvalidated',
    scopeInclusions: ['supplier_solvency', 'market_structure', 'input_cost_exposure'],
    scopeExclusions: [],
    status: 'registered',
    personaClass: 'domain',
    predicates: [
      { kind: 'subject_characteristic', value: 'sole_source_dependency', weight: 2 },
      { kind: 'consequence_class', value: 'program_disruption', weight: 2 },
    ],
  }),
  d({
    id: 'technology_trajectory',
    displayName: 'Technology Trajectory',
    archetype: 'anticipatory_unvalidated',
    scopeInclusions: ['capability_projection', 'obsolescence_horizon'],
    scopeExclusions: [],
    status: 'curated',
    personaClass: 'domain',
    // Subject-characteristic only. Registering this against adversary_capability_advantage
    // would convene it in every scenario carrying that class, including §B.2.5 Scenario 2,
    // whose stated panel does not include it.
    predicates: [{ kind: 'subject_characteristic', value: 'long_service_horizon', weight: 2 }],
  }),
];

// ---------------------------------------------------------------------------------------
// Governed-Consequence. Defined by governance boundary rather than by epistemics.
// Membership overrides other classification: a domain that is both Latent-Physical and
// Governed-Consequence is governed as Governed-Consequence (§B.3).
//
// These are registered so the registry is honest about what exists, and convening will
// never instantiate them. See `convene`'s governance gate.
// ---------------------------------------------------------------------------------------

const GOVERNED_CONSEQUENCE: Domain[] = [
  d({
    id: 'energetics',
    displayName: 'Energetics',
    archetype: 'governed_consequence',
    scopeInclusions: ['aging_and_compatibility', 'storage_and_handling_risk', 'consequence_characterization'],
    // Appendix C §C.2.4 prohibited_output. Terminating, not degrading: "a persona answering
    // the safe eighty percent of a prohibited request has answered a prohibited request."
    scopeExclusions: [
      { topic: 'synthesis_routes', routeTo: 'human:program_authority' },
      { topic: 'formulation_and_preparation', routeTo: 'human:program_authority' },
      { topic: 'perturbation_to_effect', routeTo: 'human:program_authority' },
      { topic: 'optimization_for_effect', routeTo: 'human:program_authority' },
    ],
    status: 'registered',
    personaClass: 'domain',
    predicates: [{ kind: 'consequence_class', value: 'safety_event', weight: 2 }],
  }),
];

export const SEED_DOMAINS: readonly Domain[] = [
  ...LATENT_PHYSICAL,
  ...IMMEDIATE_OBSERVABLE,
  ...ATTRIBUTIVE_CONTESTED,
  ...PROCEDURAL_INTERPRETIVE,
  ...ANTICIPATORY_UNVALIDATED,
  ...GOVERNED_CONSEQUENCE,
];

export const SEED_REGISTRY: Registry = { domains: SEED_DOMAINS };
