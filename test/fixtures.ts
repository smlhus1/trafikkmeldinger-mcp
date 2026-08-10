import type { Message } from "../src/types.js";

/**
 * Four real message shapes, frozen.
 *
 * Written as TypeScript rather than JSON for two reasons: the compiler then checks the
 * fixture still matches `Message`, so a type change cannot leave the tests passing
 * against a shape the server no longer produces — and there is no JSON file to copy
 * into `dist` for the tests to find.
 *
 * Captured from the live API on 2026-08-10. Between them they cover every branch that
 * matters: a night closure split across midnight, weekday-only daytime work on a county
 * road stored as "F27", a message with no recurrence rules at all, and one that has not
 * started yet.
 */
export const MESSAGES: Message[] = [
  {
    "id": "FIXTURE.oyertunnelen",
    "type": "RoadClosed",
    "descriptionOfLocation": "E6 Øyertunnelen i Øyer, Innlandet",
    "descriptionOfTrafficMessage": "Vegarbeid, vegen er stengt, gyldig mellom 20:00 og 06:00 mandag, tirsdag, onsdag og torsdag fra 10.08.2026 til 14.08.2026.|Omkjøring er skiltet.",
    "validPeriodText": "Vegen er stengt mellom 20:00 og 06:00 mandag, tirsdag, onsdag og torsdag fra 10.08.2026 til 14.08.2026.",
    "activityStatus": "future",
    "isActiveNow": false,
    "trafficImpact": "small",
    "trafficStatus": "RoadClosed",
    "nextTrafficStatus": {
      "trafficStatus": "RoadClosed",
      "nextChangeTime": "2026-08-10T20:00:00+02:00"
    },
    "trafficRegulations": [
      {
        "description": "Veien er stengt",
        "type": "roadClosed"
      },
      {
        "description": "Omkjøring er skiltet",
        "type": "followDiversionSigns"
      }
    ],
    "startTime": "2026-08-10T20:00:00+02:00",
    "estimatedEndTime": "2026-08-14T06:00:00+02:00",
    "locationDescriptionDetails": {
      "fromLocation": {
        "road": "E6",
        "name": "Øyertunnelen",
        "municipality": "Øyer",
        "county": "Innlandet"
      }
    },
    "location": {
      "isInTunnel": true,
      "counties": [
        {
          "name": "Innlandet",
          "code": 34
        }
      ],
      "municipalities": [],
      "roads": [
        {
          "name": "",
          "number": "E6",
          "category": "E"
        }
      ]
    },
    "validityPeriods": [
      {
        "startOfPeriod": "2026-08-10T20:00:00+02:00",
        "endOfPeriod": "2026-08-13T23:59:59+02:00",
        "applicableDays": [
          "monday",
          "tuesday",
          "wednesday",
          "thursday"
        ],
        "timeOfDay": [
          {
            "startTimeOfPeriod": "20:00:00+02:00",
            "endTimeOfPeriod": "23:59:59+02:00"
          }
        ]
      },
      {
        "startOfPeriod": "2026-08-11T00:00:00+02:00",
        "endOfPeriod": "2026-08-14T06:00:00+02:00",
        "applicableDays": [
          "tuesday",
          "wednesday",
          "thursday",
          "friday"
        ],
        "timeOfDay": [
          {
            "startTimeOfPeriod": "00:00:00+02:00",
            "endTimeOfPeriod": "06:00:00+02:00"
          }
        ]
      }
    ]
  },
  {
    "id": "FIXTURE.venabygd",
    "type": "RoadWork",
    "descriptionOfLocation": "Fv. 27 Venabygd kyrkje i Ringebu, Innlandet - fv. 27 Venaheim i Ringebu, Innlandet",
    "descriptionOfTrafficMessage": "Vegarbeid, gyldig mellom 07:00 og 19:00 mandag, tirsdag, onsdag, torsdag og fredag fra 25.06.2026 til 31.08.2026.|Fartsgrense 50 km/t, lysregulering.",
    "validPeriodText": "Vegarbeid mellom 07:00 og 19:00 mandag til fredag fra 25.06.2026 til 31.08.2026.",
    "activityStatus": "active",
    "isActiveNow": true,
    "trafficImpact": "large",
    "trafficStatus": "Regulation",
    "trafficRegulations": [
      {
        "description": "Fartsgrense 50 km/t",
        "type": "speedLimit"
      },
      {
        "description": "Lysregulering",
        "type": "trafficLights"
      }
    ],
    "startTime": "2026-06-25T07:00:00+02:00",
    "estimatedEndTime": "2026-08-31T19:00:00+02:00",
    "locationDescriptionDetails": {
      "fromLocation": {
        "road": "Fv. 27",
        "name": "Venabygd kyrkje",
        "municipality": "Ringebu",
        "county": "Innlandet"
      },
      "toLocation": {
        "name": "Venaheim",
        "municipality": "Ringebu",
        "county": "Innlandet"
      }
    },
    "location": {
      "isInTunnel": false,
      "counties": [
        {
          "name": "Innlandet",
          "code": 34
        }
      ],
      "municipalities": [],
      "roads": [
        {
          "name": "",
          "number": "F27",
          "category": "F"
        }
      ]
    },
    "validityPeriods": [
      {
        "startOfPeriod": "2026-06-25T07:00:00+02:00",
        "endOfPeriod": "2026-08-31T19:00:00+02:00",
        "applicableDays": [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday"
        ],
        "timeOfDay": [
          {
            "startTimeOfPeriod": "07:00:00+02:00",
            "endTimeOfPeriod": "19:00:00+02:00"
          }
        ]
      }
    ]
  },
  {
    "id": "FIXTURE.espa",
    "type": "RoadWork",
    "descriptionOfLocation": "E6 Espatunnelen i Stange, Innlandet",
    "descriptionOfTrafficMessage": "Vegarbeid, ett påvirket kjørefelt.",
    "activityStatus": "active",
    "isActiveNow": true,
    "trafficImpact": "none",
    "trafficStatus": "RoadOpen",
    "startTime": "2026-08-10T07:14:47+02:00",
    "estimatedEndTime": "2026-08-13T16:00:00+02:00",
    "locationDescriptionDetails": {
      "fromLocation": {
        "road": "E6",
        "name": "Espatunnelen",
        "municipality": "Stange",
        "county": "Innlandet"
      }
    },
    "location": {
      "isInTunnel": true,
      "counties": [
        {
          "name": "Innlandet",
          "code": 34
        }
      ],
      "municipalities": [],
      "roads": [
        {
          "name": "",
          "number": "E6",
          "category": "E"
        }
      ]
    }
  },
  {
    "id": "FIXTURE.hundorp",
    "type": "RoadClosed",
    "descriptionOfLocation": "E6 Hundorptunnelen i Sør-Fron, Innlandet",
    "descriptionOfTrafficMessage": "Vegarbeid, vegen er stengt.|Omkjøring er skiltet.",
    "activityStatus": "future",
    "isActiveNow": false,
    "trafficImpact": "very_large",
    "trafficStatus": "RoadClosed",
    "startTime": "2026-08-18T20:00:00+02:00",
    "estimatedEndTime": "2026-08-19T06:00:00+02:00",
    "locationDescriptionDetails": {
      "fromLocation": {
        "road": "E6",
        "name": "Hundorptunnelen",
        "municipality": "Sør-Fron",
        "county": "Innlandet"
      }
    },
    "location": {
      "isInTunnel": true,
      "counties": [
        {
          "name": "Innlandet",
          "code": 34
        }
      ],
      "municipalities": [],
      "roads": [
        {
          "name": "",
          "number": "E6",
          "category": "E"
        }
      ]
    }
  }
];

export const byId = (id: string): Message => {
  const hit = MESSAGES.find((m) => m.id === id);
  if (!hit) throw new Error(`Ukjent fikstur: ${id}`);
  return hit;
};
