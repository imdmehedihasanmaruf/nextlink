'use strict';

/**
 * Reproduce the ticket_details update that the CRM service performs.
 * Run with:  node scripts/repro-ticket-update.js
 */

const db = require('../src/lib/db');

async function main() {
  const ticket = await db.queryOne("SELECT id FROM tickets LIMIT 1");
  console.log('ticket:', ticket?.id);

  const attempts = [
    {
      name: 'without casts',
      sql: `UPDATE ticket_details
              SET first_response_at = COALESCE($2, first_response_at),
                  resolved_at = $3,
                  updated_at = NOW()
            WHERE ticket_id = $1`,
      params: [ticket.id, new Date(), null],
    },
    {
      name: 'with timestamptz casts',
      sql: `UPDATE ticket_details
              SET first_response_at = COALESCE($2::timestamptz, first_response_at),
                  resolved_at = $3::timestamptz,
                  updated_at = NOW()
            WHERE ticket_id = $1`,
      params: [ticket.id, new Date(), null],
    },
    {
      name: 'with null cast',
      sql: `UPDATE ticket_details
              SET first_response_at = COALESCE($2::timestamptz, first_response_at),
                  resolved_at = $3::timestamptz,
                  updated_at = NOW()
            WHERE ticket_id = $1`,
      params: [ticket.id, new Date(), null],
    },
  ];

  for (const attempt of attempts) {
    try {
      await db.query(attempt.sql, attempt.params);
      console.log(`  OK    ${attempt.name}`);
    } catch (error) {
      console.log(`  FAIL  ${attempt.name} -> ${error.message}`);
    }
  }

  await db.close();
}

main().catch(async (error) => {
  console.error(error);
  await db.close();
});
