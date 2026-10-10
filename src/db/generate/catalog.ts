/**
 * Static catalog for the test-data generator: coverage rules, damage types
 * that deliberately have no rule, and natural-language description templates.
 *
 * Pure data and pure functions only (no DB access), so it is fully unit-testable.
 * Descriptions are read by the LLM, so they must never mention the scenario a
 * claim was generated for or the outcome we expect.
 */

/** A uniformly distributed random source; see `createRng` in scenarios.ts. */
export interface Rng {
    /** Float in [0, 1). */
    next(): number;
    /** Integer in [min, max], both inclusive. */
    int(min: number, max: number): number;
    /** Float in [min, max). */
    between(min: number, max: number): number;
    pick<T>(items: readonly T[]): T;
}

export const POLICY_TYPES = ["auto", "home", "travel"] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

/** Builds one natural-language claim description from the random source. */
export type DescriptionTemplate = (rng: Rng) => string;

export interface RuleSpec {
    policy_type: PolicyType;
    damage_type: string;
    max_coverage_amount: number;
    conditions: string;
}

export interface CatalogRule extends RuleSpec {
    /** Descriptions that satisfy every condition of the rule (minor damage). */
    minor: readonly DescriptionTemplate[];
    /** Descriptions that satisfy every condition of the rule (large or total loss). */
    major: readonly DescriptionTemplate[];
    /** Descriptions in which one of the rule's exclusions clearly applies. */
    exclusion: readonly DescriptionTemplate[];
    /** Smallest amount for which the exclusion is relevant (e.g. the $1000 police-report threshold). */
    exclusionMinAmount?: number;
    /**
     * Descriptions in which the claimant is unsure whether the evidence a condition
     * requires (police report, irregularity report, forced entry) exists. Empty when
     * the rule requires no evidence.
     */
    uncertainEvidence: readonly DescriptionTemplate[];
    /** Smallest amount for which the evidence condition applies (e.g. collision over $1000). */
    uncertainEvidenceMinAmount?: number;
    /**
     * Descriptions in which the cause could fall on either side of an exclusion
     * (river flood or roof leak, a pre-existing condition or not). Empty when the
     * rule has no cause-based exclusion.
     */
    uncertainCause: readonly DescriptionTemplate[];
}

/** A (policy type, damage type) pair the generator never creates a rule for. */
export interface UncoveredDamage {
    policy_type: PolicyType;
    damage_type: string;
    minAmount: number;
    maxAmount: number;
    descriptions: readonly DescriptionTemplate[];
}

const weekday = (rng: Rng): string =>
    rng.pick(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
const timeOfDay = (rng: Rng): string => rng.pick(["morning", "afternoon", "evening", "night"]);
const city = (rng: Rng): string => rng.pick(["Lisbon", "Prague", "Barcelona", "Vienna", "Krakow", "Bangkok", "Mexico City"]);
const reportNo = (rng: Rng): string => `${rng.pick(["PR", "CR", "INC"])}-${rng.int(100000, 999999)}`;

/**
 * Coverage rules the generator makes sure exist. The first three match
 * src/db/seed.ts exactly, so a seeded database is extended, never contradicted.
 */
export const RULE_CATALOG: readonly CatalogRule[] = [
    {
        policy_type: "auto",
        damage_type: "collision",
        max_coverage_amount: 50000,
        conditions: "Requires police report if over $1000",
        minor: [
            (r) =>
                `Another driver ran a red light and hit my front bumper on ${weekday(r)} ${timeOfDay(r)}. ` +
                `The police attended the scene and filed report ${reportNo(r)}. Bumper and headlight need replacing.`,
            (r) =>
                `I was rear-ended while stopped in traffic. Police report ${reportNo(r)} was filed on the spot; ` +
                "the rear bumper, trunk lid and parking sensors are damaged.",
            (r) =>
                `Slid on ice and hit a guardrail on the ${timeOfDay(r)} commute. Officers came out and gave me ` +
                `report number ${reportNo(r)}. Front wing and wheel arch are dented.`,
        ],
        major: [
            (r) =>
                `My car was hit head-on by a delivery van on the highway. The car was towed from the scene and the ` +
                `garage says it is a total loss. Police report ${reportNo(r)} is attached.`,
            (r) =>
                `Multi-vehicle pile-up in fog on ${weekday(r)}. Engine, chassis and airbags are all damaged. ` +
                `Highway police filed report ${reportNo(r)}.`,
        ],
        exclusion: [
            () =>
                "Reversed into a concrete pillar in a parking garage. Nobody else was involved so I just drove home; " +
                "the rear bumper and tailgate are badly dented and the backup camera is broken.",
            (r) =>
                `Clipped another car while changing lanes on ${weekday(r)}. We swapped phone numbers and went our ` +
                "separate ways. Passenger doors and side mirror need bodywork.",
        ],
        exclusionMinAmount: 1500,
        uncertainEvidence: [
            () =>
                "Another car pulled out of a side street and hit my driver's door. I think my wife may have called " +
                "the police afterwards, but I'm not sure a report was ever filed and I don't have a number.",
            (r) =>
                `I was hit at a roundabout on ${weekday(r)}. There was a police car nearby and an officer may have ` +
                "taken some notes; I can't remember if he said a report would be made. Front bumper and grille are smashed.",
        ],
        uncertainEvidenceMinAmount: 1500,
        uncertainCause: [],
    },
    {
        policy_type: "auto",
        damage_type: "glass",
        max_coverage_amount: 1000,
        conditions: "No deductible",
        minor: [
            () => "A stone thrown up by a truck chipped the windshield and the crack is spreading across the driver's view.",
            () => "Rear window cracked overnight during a hailstorm while the car was parked on the street.",
        ],
        major: [
            () => "Windshield, sunroof and both front side windows were shattered by large hail.",
            () => "A tree branch fell on the parked car and smashed the windshield and the rear window.",
        ],
        exclusion: [],
        uncertainEvidence: [],
        uncertainCause: [],
    },
    {
        policy_type: "auto",
        damage_type: "theft",
        max_coverage_amount: 30000,
        conditions:
            "Theft must be reported to the police within 48 hours. Personal belongings left in the vehicle are not covered",
        minor: [
            (r) =>
                `Someone broke into my car overnight and stole the wheels. I reported it to the police the next morning ` +
                `(report ${reportNo(r)}).`,
            (r) =>
                `The catalytic converter was cut out while the car was parked at the train station. ` +
                `Reported to the police the same day, reference ${reportNo(r)}.`,
        ],
        major: [
            (r) =>
                `My car was stolen from outside my house on ${weekday(r)} night. I called the police within the hour ` +
                `and the theft report number is ${reportNo(r)}. The car has not been found.`,
        ],
        exclusion: [
            () =>
                "My laptop, camera and a suitcase were stolen from the back seat after someone smashed the window " +
                "at a rest stop. I am claiming for the stolen items.",
            () =>
                "My car disappeared from the airport long-stay car park while I was abroad. I only noticed when I " +
                "got back nine days later and reported it to the police then.",
        ],
        uncertainEvidence: [
            () =>
                "My car was stolen from the supermarket car park. My son said he would phone the police for me " +
                "that weekend; I believe he did, but I don't know when, and I have no reference number.",
        ],
        uncertainCause: [],
    },
    {
        policy_type: "home",
        damage_type: "water_damage",
        max_coverage_amount: 100000,
        conditions: "Not covered for floods, only internal leaks",
        minor: [
            () => "A pipe under the kitchen sink burst while we were at work and soaked the cabinets and the floor.",
            () =>
                "The washing machine hose split and water leaked through the ceiling into the living room below.",
            () => "Our upstairs bathroom's toilet supply line failed and water ran down the inside of the walls.",
        ],
        major: [
            () =>
                "The hot water tank in the attic ruptured overnight. Water came through two floors; ceilings, " +
                "floors, wiring and furniture all need replacing.",
            () =>
                "A frozen pipe burst while we were away for three weeks. The whole ground floor was soaked from the " +
                "inside and mould has started growing behind the drywall.",
        ],
        exclusion: [
            () =>
                "After two days of heavy rain the river burst its banks and floodwater came into the ground floor " +
                "of the house, ruining the floors and furniture.",
            () =>
                "A flash flood after a storm sent water and mud through the garage and basement. Everything stored " +
                "down there was destroyed.",
        ],
        uncertainEvidence: [],
        uncertainCause: [
            () =>
                "Water came into the downstairs rooms during the big storm. I'm not sure if it was the river " +
                "rising at the bottom of the garden or rain getting in through the roof; the carpets and walls are soaked.",
            () =>
                "We found the basement under several centimetres of water after a night of heavy rain. It could " +
                "have been groundwater coming up or the old pipe by the boiler; the plumber couldn't say which.",
        ],
    },
    {
        policy_type: "home",
        damage_type: "fire",
        max_coverage_amount: 250000,
        conditions: "Not covered if the property was left unoccupied for more than 60 days before the fire",
        minor: [
            () => "A pan of oil caught fire on the stove while I was cooking. The kitchen cabinets and extractor hood are burnt.",
            () =>
                "An electrical fault in the living room socket started a small fire. The wall, curtains and sofa " +
                "are damaged by fire and smoke.",
        ],
        major: [
            () =>
                "A fire started in the garage during the night and spread to the house. The fire brigade says the " +
                "roof and the first floor are a total loss.",
        ],
        exclusion: [
            () =>
                "Fire destroyed our holiday cottage. Nobody had been there since last autumn, about five months " +
                "ago; a neighbour saw the smoke and called the fire brigade.",
        ],
        uncertainEvidence: [],
        uncertainCause: [
            () =>
                "A fire damaged the kitchen of our second home. We had been away for a while before it happened, " +
                "maybe six weeks, maybe nine; I would have to check the dates.",
        ],
    },
    {
        policy_type: "home",
        damage_type: "theft",
        max_coverage_amount: 20000,
        conditions: "Requires signs of forced entry and a police report",
        minor: [
            (r) =>
                `Burglars forced the back door while we were out on ${weekday(r)} and took a TV and a laptop. ` +
                `The police came and gave us report ${reportNo(r)}.`,
        ],
        major: [
            (r) =>
                `Our house was burgled while we were on holiday. They broke the patio door lock and took jewellery, ` +
                `electronics and a bicycle. Police report ${reportNo(r)}.`,
        ],
        exclusion: [
            () =>
                "I came home and my bike and a games console were gone from the hallway. I think I left the front " +
                "door unlocked; there is no damage to the door or windows.",
        ],
        uncertainEvidence: [
            () =>
                "Jewellery and a laptop were taken from the house while we were out. The back door lock was a bit " +
                "loose anyway, so I can't really tell if it was forced. My partner may have rung the police, I'm not sure.",
        ],
        uncertainCause: [],
    },
    {
        policy_type: "travel",
        damage_type: "medical",
        max_coverage_amount: 75000,
        conditions: "Emergency treatment only. Pre-existing conditions are not covered",
        minor: [
            (r) =>
                `I broke my wrist after slipping on wet stairs at the hotel in ${city(r)} and was treated in the ` +
                "emergency room.",
            (r) => `Got severe food poisoning in ${city(r)} and spent two nights in hospital on an IV drip.`,
        ],
        major: [
            (r) =>
                `I was hit by a scooter in ${city(r)} and needed emergency surgery on my leg, followed by five days ` +
                "in intensive care and a medical flight home.",
        ],
        exclusion: [
            (r) =>
                `My long-standing heart condition, which I have been treated for since 2019, got worse while I was ` +
                `in ${city(r)} and I was admitted to hospital for monitoring.`,
        ],
        uncertainEvidence: [],
        uncertainCause: [
            (r) =>
                `I had chest pains in ${city(r)} and was admitted to hospital for two nights. I've had some chest ` +
                "discomfort on and off over the past year but never saw a doctor about it, so I don't know if it's related.",
            (r) =>
                `My back gave out while carrying luggage in ${city(r)} and I needed hospital treatment. I have had ` +
                "back trouble before, though I'm not sure it was the same problem.",
        ],
    },
    {
        policy_type: "travel",
        damage_type: "baggage",
        max_coverage_amount: 3000,
        conditions:
            "Requires an airline property irregularity report. Items left unattended in public places are not covered",
        minor: [
            (r) =>
                `The airline lost my checked suitcase on the flight to ${city(r)}. I filed a property irregularity ` +
                `report at the airport desk (ref ${reportNo(r)}) and had to buy clothes and toiletries.`,
        ],
        major: [
            (r) =>
                `Both checked bags never arrived in ${city(r)}. The airline gave me property irregularity report ` +
                `${reportNo(r)} and confirmed after 21 days that the bags are lost for good.`,
        ],
        exclusion: [
            (r) =>
                `I left my backpack with my camera on a cafe table in ${city(r)} while I went to order, and it was ` +
                "gone when I came back.",
        ],
        uncertainEvidence: [
            (r) =>
                `My suitcase did not arrive in ${city(r)}. I believe the airline gave me some form at the desk, but ` +
                "I can't find it now and I'm not sure what it was called.",
        ],
        uncertainCause: [
            (r) =>
                `My bag went missing at the airport in ${city(r)}. I put it down for a moment near the gate and it may ` +
                "have been taken there, or the airline may have lost it after check-in; I honestly don't know which.",
        ],
    },
];

/** Damage types the generator never creates a rule for, so `check_coverage` finds nothing. */
export const UNCOVERED_DAMAGE: readonly UncoveredDamage[] = [
    {
        policy_type: "auto",
        damage_type: "mechanical_breakdown",
        minAmount: 800,
        maxAmount: 6500,
        descriptions: [
            () => "The gearbox failed on the motorway and the garage says it needs a full replacement.",
            () => "The engine started knocking and then seized; the mechanic says the timing chain snapped.",
        ],
    },
    {
        policy_type: "home",
        damage_type: "earthquake",
        minAmount: 5000,
        maxAmount: 60000,
        descriptions: [
            () => "An earthquake cracked the foundation and two load-bearing walls. Part of the chimney fell through the roof.",
        ],
    },
    {
        policy_type: "home",
        damage_type: "pest_damage",
        minAmount: 1500,
        maxAmount: 12000,
        descriptions: [
            () => "Termites have eaten through the floor joists in the back bedroom and the floor is sagging.",
            () => "Rats chewed through the wiring in the loft and the electrics need to be redone.",
        ],
    },
    {
        policy_type: "travel",
        damage_type: "trip_cancellation",
        minAmount: 400,
        maxAmount: 5000,
        descriptions: [
            (r) => `I had to cancel my trip to ${city(r)} because of a work commitment and could not get a refund for the flights and hotel.`,
        ],
    },
];

/** Renders a sentence stating a figure (e.g. a repair quote) the claimant paid or was quoted. */
export type QuoteTemplate = (figure: string) => string;

/**
 * Sentences that state a repair quote, invoice or receipt total. Appended to a
 * normal description with a figure clearly different from claim_amount.
 */
export const QUOTE_SENTENCES: Readonly<Record<PolicyType, readonly QuoteTemplate[]>> = {
    auto: [
        (figure) => `The garage's written repair quote came to ${figure}.`,
        (figure) => `The body shop invoice I paid was ${figure} in total.`,
    ],
    home: [
        (figure) => `The contractor's written estimate for all the repairs is ${figure}.`,
        (figure) => `The repair invoice came to ${figure}.`,
    ],
    travel: [
        (figure) => `My receipts for everything add up to ${figure}.`,
        (figure) => `The bill I paid came to ${figure} in total.`,
    ],
};
