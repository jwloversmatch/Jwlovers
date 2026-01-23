const applyPagination = async (Model, query, filters, options = {}) => {
  const {
    limit = 20,
    offset = 0,
    sortField = 'createdAt',
    sortOrder = 'desc'
  } = filters;
  
  const {
    populate = [],
    select,
    lean = true
  } = options;
  
  const total = await Model.countDocuments(query);
  
  let queryBuilder = Model.find(query);
  
  // Apply population
  populate.forEach(pop => {
    if (typeof pop === 'string') {
      queryBuilder = queryBuilder.populate(pop);
    } else {
      queryBuilder = queryBuilder.populate(pop);
    }
  });
  
  // Apply selection
  if (select) {
    queryBuilder = queryBuilder.select(select);
  }
  
  // Apply sorting
  const sort = { [sortField]: sortOrder === 'desc' ? -1 : 1 };
  if (sortField === 'lastMessageAt') {
    sort.createdAt = sortOrder === 'desc' ? -1 : 1;
  }
  
  queryBuilder = queryBuilder.sort(sort);
  
  // Apply pagination
  queryBuilder = queryBuilder
    .skip(parseInt(offset))
    .limit(Math.min(parseInt(limit), options.maxLimit || 100));
  
  if (lean) {
    queryBuilder = queryBuilder.lean();
  }
  
  const items = await queryBuilder.exec();
  
  return { total, items };
};

module.exports = {
  applyPagination
};