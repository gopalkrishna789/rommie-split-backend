/**
 * MongoDB Query Adapter
 * Provides a SQL-like query interface for MongoDB to minimize code changes
 */
import Room from './models/Room.js';
import Member from './models/Member.js';
import Expense from './models/Expense.js';
import Split from './models/Split.js';
import RecurringExpense from './models/RecurringExpense.js';
import Activity from './models/Activity.js';

/**
 * Parse SQL-like query and execute MongoDB operation
 * This is a simplified adapter - handles common patterns
 */
export async function query(text, params = []) {
  const sql = text.trim();
  const sqlUpper = sql.toUpperCase();

  try {
    // SELECT queries
    if (sqlUpper.startsWith('SELECT')) {
      return handleSelect(sql, params);
    }
    
    // INSERT queries
    if (sqlUpper.startsWith('INSERT')) {
      return handleInsert(sql, params);
    }
    
    // UPDATE queries
    if (sqlUpper.startsWith('UPDATE')) {
      return handleUpdate(sql, params);
    }
    
    // DELETE queries
    if (sqlUpper.startsWith('DELETE')) {
      return handleDelete(sql, params);
    }

    // Unsupported query
    console.warn('Unsupported query type:', sql.slice(0, 50));
    return { rows: [], rowCount: 0 };
    
  } catch (error) {
    console.error('MongoDB query error:', error.message);
    console.error('SQL:', sql.slice(0, 200));
    throw error;
  }
}

export async function getClient() {
  // MongoDB doesn't need client pooling like PostgreSQL
  return {
    query,
    release: () => {},
  };
}

// Helper: Extract table name from SQL
function getTableName(sql) {
  const fromMatch = sql.match(/FROM\s+(\w+)/i);
  const intoMatch = sql.match(/INTO\s+(\w+)/i);
  const updateMatch = sql.match(/UPDATE\s+(\w+)/i);
  const tableName = (fromMatch || intoMatch || updateMatch)?.[1];
  return tableName;
}

// Helper: Get Mongoose model by table name
function getModel(tableName) {
  const modelMap = {
    rooms: Room,
    members: Member,
    expenses: Expense,
    splits: Split,
    recurring_expenses: RecurringExpense,
    activity_log: Activity,
  };
  return modelMap[tableName?.toLowerCase()];
}

// Handle SELECT queries
async function handleSelect(sql, params) {
  const tableName = getTableName(sql);
  const Model = getModel(tableName);
  
  if (!Model) {
    console.warn('Unknown table:', tableName);
    return { rows: [], rowCount: 0 };
  }

  // Check if this is a COUNT query
  const countMatch = sql.match(/SELECT\s+COUNT\(\*\)\s+(?:as\s+(\w+))?/i);
  if (countMatch) {
    const whereMatch = sql.match(/WHERE\s+(.+?)$/is);
    const filter = whereMatch ? parseWhereClause(whereMatch[1], params, tableName) : {};
    const count = await Model.countDocuments(filter);
    const countField = countMatch[1] || 'count';
    console.log('COUNT query result:', { countField, count, filter });
    return { rows: [{ [countField]: count }], rowCount: 1 };
  }

  // Check if this is a SUM/COALESCE aggregate query
  const sumMatch = sql.match(/SELECT\s+COALESCE\(SUM\(([^)]+)\),\s*0\)\s+AS\s+(\w+)/i);
  if (sumMatch) {
    const sumField = sumMatch[1].trim();
    const aliasField = sumMatch[2];
    
    // Check if this query has a JOIN
    const hasJoin = sql.toUpperCase().includes(' JOIN ');
    
    if (hasJoin) {
      // Handle JOIN queries - need to manually join data
      // For now, return 0 as a safe default - JOINs need special handling
      console.warn('JOIN queries not fully supported yet, returning 0');
      return { rows: [{ [aliasField]: 0 }], rowCount: 1 };
    }
    
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:GROUP BY|$)/is);
    const filter = whereMatch ? parseWhereClause(whereMatch[1], params, tableName) : {};
    
    console.log('SUM query:', { sumField, aliasField, filter });
    
    // Handle complex field expressions like "s.share + s.carry_forward"
    if (sumField.includes('+')) {
      // For expressions like "s.share + s.carry_forward", we need to use $add in aggregation
      const fields = sumField.split('+').map(f => f.trim().split('.').pop());
      
      const result = await Model.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $add: fields.map(f => `$${f}`)
              }
            }
          }
        }
      ]);
      
      const total = result.length > 0 ? result[0].total : 0;
      console.log('Aggregate SUM result:', { total, result });
      return { rows: [{ [aliasField]: total }], rowCount: 1 };
    } else {
      // Simple field sum
      const fieldName = sumField.includes('.') ? sumField.split('.').pop() : sumField;
      const result = await Model.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            total: { $sum: `$${fieldName}` }
          }
        }
      ]);
      
      const total = result.length > 0 ? result[0].total : 0;
      console.log('Simple SUM result:', { total, result });
      return { rows: [{ [aliasField]: total }], rowCount: 1 };
    }
  }

  // Build MongoDB query from WHERE clause
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER BY|LIMIT|GROUP BY|$)/is);
  const filter = whereMatch ? parseWhereClause(whereMatch[1], params, tableName) : {};
  
  // Handle ORDER BY
  const orderMatch = sql.match(/ORDER BY\s+(.+?)(?:LIMIT|$)/i);
  let sort = {};
  if (orderMatch) {
    const orderParts = orderMatch[1].trim().split(',');
    orderParts.forEach(part => {
      const [field, direction] = part.trim().split(/\s+/);
      sort[field] = direction?.toUpperCase() === 'DESC' ? -1 : 1;
    });
  }
  
  // Handle LIMIT
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
  const limit = limitMatch ? parseInt(limitMatch[1]) : 0;
  
  // Handle OFFSET
  const offsetMatch = sql.match(/OFFSET\s+(\d+)/i);
  const skip = offsetMatch ? parseInt(offsetMatch[1]) : 0;

  // Execute query
  let query = Model.find(filter);
  
  if (Object.keys(sort).length > 0) {
    query = query.sort(sort);
  }
  
  if (limit > 0) {
    query = query.limit(limit);
  }
  
  if (skip > 0) {
    query = query.skip(skip);
  }

  const rows = await query.lean();
  
  // Convert _id back to id for compatibility
  const normalizedRows = rows.map(row => {
    const normalized = { ...row };
    // Add id field from _id
    if (row._id) {
      normalized.id = row._id;
    }
    return normalized;
  });

  return { rows: normalizedRows, rowCount: normalizedRows.length };
}

// Handle INSERT queries
async function handleInsert(sql, params) {
  const tableName = getTableName(sql);
  const Model = getModel(tableName);
  
  if (!Model) {
    console.warn('Unknown table:', tableName);
    return { rows: [], rowCount: 0 };
  }

  // Extract column names and values
  const columnsMatch = sql.match(/\(([^)]+)\)\s+VALUES/i);
  const valuesMatch = sql.match(/VALUES\s*\(([^)]+)\)/i);
  
  if (!columnsMatch || !valuesMatch) {
    console.error('Invalid INSERT syntax:', sql);
    throw new Error('Invalid INSERT syntax');
  }

  const columns = columnsMatch[1].split(',').map(c => c.trim());
  const valuePlaceholders = valuesMatch[1].split(',').map(v => v.trim());
  
  console.log('INSERT Debug:', { columns, valuePlaceholders, params });
  
  // Build document
  const doc = {};
  let paramIndex = 0;
  
  columns.forEach((col, index) => {
    const placeholder = valuePlaceholders[index];
    
    // Handle $1, $2, etc. (PostgreSQL style)
    if (placeholder.match(/^\$\d+$/)) {
      const pIndex = parseInt(placeholder.slice(1)) - 1;
      doc[col] = params[pIndex];
      paramIndex = Math.max(paramIndex, pIndex + 1);
    }
    // Handle ? (SQLite style)
    else if (placeholder === '?') {
      doc[col] = params[paramIndex];
      paramIndex++;
    }
    // Handle NOW() or CURRENT_DATE
    else if (placeholder.toUpperCase() === 'NOW()' || placeholder.toUpperCase() === 'CURRENT_DATE') {
      doc[col] = new Date();
    }
    // Handle TRUE/FALSE
    else if (placeholder.toUpperCase() === 'TRUE') {
      doc[col] = true;
    }
    else if (placeholder.toUpperCase() === 'FALSE') {
      doc[col] = false;
    }
    // Handle literal string values
    else if (placeholder.startsWith("'") && placeholder.endsWith("'")) {
      doc[col] = placeholder.slice(1, -1);
    }
    // Handle numbers
    else if (!isNaN(placeholder) && placeholder !== '') {
      doc[col] = Number(placeholder);
    }
    // Default: use as-is
    else {
      console.warn(`Unexpected placeholder format: ${placeholder}`);
      doc[col] = placeholder;
    }
  });

  // MongoDB requires _id field - use 'id' as _id if present
  console.log('Table name:', tableName, 'Has id:', !!doc.id);
  
  if (doc.id) {
    doc._id = doc.id;
    delete doc.id;
  }

  console.log('MongoDB document to insert:', doc);

  // Create document
  const created = await Model.create(doc);
  
  // Check if RETURNING clause exists
  const hasReturning = /RETURNING/i.test(sql);
  
  if (hasReturning) {
    const row = created.toObject ? created.toObject() : created;
    // Add id field from _id for compatibility
    if (row._id) {
      row.id = row._id;
    }
    return { rows: [row], rowCount: 1 };
  }

  return { rows: [], rowCount: 1 };
}

// Handle UPDATE queries
async function handleUpdate(sql, params) {
  const tableName = getTableName(sql);
  const Model = getModel(tableName);
  
  if (!Model) {
    console.warn('Unknown table:', tableName);
    return { rows: [], rowCount: 0 };
  }

  // Extract SET clause
  const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/is);
  if (!setMatch) {
    throw new Error('Invalid UPDATE syntax - missing SET or WHERE');
  }

  // Parse SET clause - split carefully to handle multiple assignments
  // We parse field = ? pairs sequentially
  const setClause = setMatch[1];
  const updates = {};
  let paramIndex = 0;

  // Match all "field = ?" or "field = value" patterns
  const setAssignments = setClause.matchAll(/(\w+)\s*=\s*(\?|\$\d+|NOW\(\)|CURRENT_DATE|TRUE|FALSE|true|false|'[^']*'|-?\d+(?:\.\d+)?)/gi);
  for (const m of setAssignments) {
    const field = m[1];
    const value = m[2];

    if (value === '?') {
      updates[field] = params[paramIndex++];
    } else if (value.match(/^\$(\d+)$/)) {
      const pIndex = parseInt(value.slice(1)) - 1;
      updates[field] = params[pIndex];
      paramIndex = Math.max(paramIndex, pIndex + 1);
    } else if (value.toUpperCase() === 'NOW()' || value.toUpperCase() === 'CURRENT_DATE') {
      updates[field] = new Date();
    } else if (value.toUpperCase() === 'TRUE') {
      updates[field] = true;
    } else if (value.toUpperCase() === 'FALSE') {
      updates[field] = false;
    } else if (value.startsWith("'") && value.endsWith("'")) {
      updates[field] = value.slice(1, -1);
    } else if (!isNaN(value) && value !== '') {
      updates[field] = Number(value);
    } else {
      updates[field] = value;
    }
  }

  // Extract WHERE clause
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:RETURNING|$)/is);
  const filter = whereMatch ? parseWhereClause(whereMatch[1], params.slice(paramIndex), tableName) : {};

  // Execute update
  const result = await Model.updateMany(filter, { $set: updates });

  // Check if RETURNING clause exists
  const hasReturning = /RETURNING/i.test(sql);
  
  if (hasReturning) {
    const updated = await Model.find(filter).lean();
    const normalizedRows = updated.map(row => {
      const normalized = { ...row };
      if (row._id) {
        normalized.id = row._id;
      }
      return normalized;
    });
    return { rows: normalizedRows, rowCount: result.modifiedCount };
  }

  return { rows: [], rowCount: result.modifiedCount };
}

// Handle DELETE queries
async function handleDelete(sql, params) {
  const tableName = getTableName(sql);
  const Model = getModel(tableName);
  
  if (!Model) {
    console.warn('Unknown table:', tableName);
    return { rows: [], rowCount: 0 };
  }

  // Extract WHERE clause
  const whereMatch = sql.match(/WHERE\s+(.+?)$/is);
  const filter = whereMatch ? parseWhereClause(whereMatch[1], params, tableName) : {};

  // Execute delete
  const result = await Model.deleteMany(filter);

  return { rows: [], rowCount: result.deletedCount };
}

// Parse WHERE clause into MongoDB filter
function parseWhereClause(whereClause, params, tableName = null) {
  const filter = {};

  // Handle ? placeholders (SQLite style)
  let clause = whereClause;
  const questionMarks = (whereClause.match(/\?/g) || []).length;
  
  if (questionMarks > 0) {
    // Replace ? with actual values for parsing
    for (let i = 0; i < questionMarks && i < params.length; i++) {
      const value = params[i];
      const replacement = typeof value === 'string' ? `'${value}'` : value;
      clause = clause.replace('?', replacement);
    }
  }

  // Simple parser for common patterns
  // Handle: field = $1 or field = 'value'
  const equalMatches = clause.matchAll(/(\w+)\s*=\s*(?:\$(\d+)|'([^']+)'|(\d+))/g);
  for (const match of equalMatches) {
    const field = match[1];
    let value;
    
    if (match[2]) {
      // $1 style
      const pIndex = parseInt(match[2]) - 1;
      value = params[pIndex];
    } else if (match[3]) {
      // 'string' style
      value = match[3];
    } else if (match[4]) {
      // number style
      value = Number(match[4]);
    }
    
    // Convert 'id' to '_id' for MongoDB (for all models now)
    filter[field === 'id' ? '_id' : field] = value;
  }

  // Handle: field IS NULL
  const nullMatches = clause.matchAll(/(\w+)\s+IS\s+NULL/gi);
  for (const match of nullMatches) {
    filter[match[1]] = null;
  }

  // Handle: field IS NOT NULL
  const notNullMatches = clause.matchAll(/(\w+)\s+IS\s+NOT\s+NULL/gi);
  for (const match of notNullMatches) {
    filter[match[1]] = { $ne: null };
  }

  // Handle: field IN (...)
  const inMatch = clause.match(/(\w+)\s+IN\s*\(([^)]+)\)/i);
  if (inMatch) {
    const field = inMatch[1];
    const values = inMatch[2].split(',').map(v => v.trim().replace(/'/g, ''));
    filter[field] = { $in: values };
  }

  // Handle: field > value, field < value, field >= value, field <= value
  const comparisonMatches = clause.matchAll(/(\w+)\s*(>=|<=|>|<)\s*(?:'([^']+)'|(\d+))/g);
  for (const match of comparisonMatches) {
    const field = match[1];
    const operator = match[2];
    const value = match[3] || Number(match[4]);
    
    const mongoOp = {
      '>': '$gt',
      '<': '$lt',
      '>=': '$gte',
      '<=': '$lte',
    }[operator];
    
    filter[field] = { [mongoOp]: value };
  }

  return filter;
}

export default { query, getClient };
