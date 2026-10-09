import { pool, query } from './client';
import { createTables } from './schema';

async function seed() {
    try {
        console.log('Creating tables...');
        await query(createTables);
        
        console.log('Clearing existing data...');
        await query('TRUNCATE TABLE audit_logs, claims, coverage_rules, policies RESTART IDENTITY CASCADE;');

        console.log('Inserting mock policies...');
        await query(`
            INSERT INTO policies (user_id, policy_number, status, type) VALUES
            ('user_1', 'POL-AUTO-12345', 'active', 'auto'),
            ('user_2', 'POL-HOME-67890', 'active', 'home'),
            ('user_3', 'POL-AUTO-99999', 'inactive', 'auto');
        `);

        console.log('Inserting mock coverage rules...');
        await query(`
            INSERT INTO coverage_rules (policy_type, damage_type, max_coverage_amount, conditions) VALUES
            ('auto', 'collision', 50000.00, 'Requires police report if over $1000'),
            ('auto', 'glass', 1000.00, 'No deductible'),
            ('home', 'water_damage', 100000.00, 'Not covered for floods, only internal leaks');
        `);

        console.log('Inserting mock claims...');
        await query(`
            INSERT INTO claims (policy_id, claim_amount, damage_type, status, description) VALUES
            (1, 1500.00, 'collision', 'pending', 'Fender bender in parking lot'),
            (2, 5000.00, 'water_damage', 'pending', 'Burst pipe in kitchen');
        `);

        console.log('Database seeded successfully!');
    } catch (err) {
        console.error('Error seeding database:', err);
    } finally {
        await pool.end();
    }
}

seed();

