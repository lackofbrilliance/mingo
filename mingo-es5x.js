// Mingo.js
// Copyright (c) 2017 Francis Asante <kofrasa@gmail.com>
// MIT

;(root => {
  'use strict'

  let VERSION = '0.10.0'

  // global on the server, window in the browser
  let Mingo = {}
  let previousMingo

  // backup previous Mingo
  if (root !== null) {
    previousMingo = root.Mingo
  }

  Mingo.noConflict = () => {
    root.Mingo = previousMingo
    return Mingo
  }

  let isNodeJS = (typeof module !== 'undefined' && module.exports && typeof require !== 'undefined')

  // Export the Mingo object for Node.js
  if (isNodeJS) {
    module.exports = Mingo
  } else {
    root.Mingo = Mingo
  }

  // short-hand for common functions
  let arrayPush = Array.prototype.push
  let arraySlice = Array.prototype.slice
  let stringify = JSON.stringify

  // Settings used by Mingo internally
  let settings = {
    key: '_id'
  }

  Mingo.idKey = () => settings.key

  /**
   * Return helper functions used internally
   * This is exposed to support users writing custom operators and also for testing
   *
   * @return {Object} An object of functions
   */
  Mingo._internal = () => {
    // We need explicit naming to survive minification
    return {
      'assert': assert.bind(null),
      'computeValue': computeValue.bind(null),
      'each': each.bind(null),
      'err': err.bind(null),
      'falsey': falsey.bind(null),
      'flatten': flatten.bind(null),
      'groupBy': groupBy.bind(null),
      'has': has.bind(null),
      'hashcode': hashcode.bind(null),
      'inArray': inArray.bind(null),
      'intersection': intersection.bind(null),
      'isArray': isArray.bind(null),
      'isBoolean': isBoolean.bind(null),
      'isDate': isDate.bind(null),
      'isEmpty': isEmpty.bind(null),
      'isEqual': isEqual.bind(null),
      'isFunction': isFunction.bind(null),
      'isNull': isNull.bind(null),
      'isNumber': isNumber.bind(null),
      'isObject': isObject.bind(null),
      'isObjectLike': isObjectLike.bind(null),
      'isRegExp': isRegExp.bind(null),
      'isString': isString.bind(null),
      'isUndefined': isUndefined.bind(null),
      'isUnknown': isUnknown.bind(null),
      'keys': keys.bind(null),
      'map': map.bind(null),
      'notInArray': notInArray.bind(null),
      'ops': ops.bind(null),
      'resolve': resolve.bind(null),
      'resolveObj': resolveObj.bind(null),
      'slice': slice.bind(null),
      'stddev': stddev.bind(null),
      'stringify': stringify.bind(null),
      'sortBy': sortBy.bind(null),
      'truthy': truthy.bind(null),
      'type': type.bind(null),
      'union': union.bind(null),
      'unique': unique.bind(null)
    }
  }

  /**
   * Setup default settings for Mingo
   * @param options
   */
  Mingo.setup = (options) => { Object.assign(settings, options || {}); return }

  /**
   * Query object to test collection elements with
   * @param criteria the pass criteria for the query
   * @param projection optional projection specifiers
   * @constructor
   */
  class Query {
    constructor (criteria, projection) {
      this._criteria = criteria
      this._projection = projection
      this._compiled = []
      this._compile()
    }

    _compile () {
      if (isEmpty(this._criteria)) return

      assert(isObject(this._criteria), 'Criteria must be of type Object')

      for (let field in this._criteria) {
        if (has(this._criteria, field)) {
          let expr = this._criteria[field]
          if (['$and', '$or', '$nor', '$where'].includes(field)) {
            this._processOperator(field, field, expr)
          } else {
            // normalize expression
            expr = normalize(expr)
            for (let op in expr) {
              if (has(expr, op)) {
                this._processOperator(field, op, expr[op])
              }
            }
          }
        }
      }
    }

    _processOperator (field, operator, value) {
      if (ops(OP_QUERY).includes(operator)) {
        this._compiled.push(queryOperators[operator](field, value))
      } else {
        err("Invalid query operator '" + operator + "' detected")
      }
    }

    /**
     * Checks if the object passes the query criteria. Returns true if so, false otherwise.
     * @param obj
     * @returns {boolean}
     */
    test (obj) {
      for (let i = 0; i < this._compiled.length; i++) {
        if (!this._compiled[i].test(obj)) {
          return false
        }
      }
      return true
    }

    /**
     * Performs a query on a collection and returns a cursor object.
     * @param collection
     * @param projection
     * @returns {Mingo.Cursor}
     */
    find (collection, projection) {
      return new Mingo.Cursor(collection, this, projection)
    }

    /**
     * Remove matched documents from the collection returning the remainder
     * @param collection
     * @returns {Array}
     */
    remove (collection) {
      let arr = []
      for (let i = 0; i < collection.length; i++) {
        if (!this.test(collection[i])) {
          arr.push(collection[i])
        }
      }
      return arr
    }
  }
  Mingo.Query = Query

  /**
   * Cursor to iterate and perform filtering on matched objects
   * @param collection
   * @param query
   * @param projection
   * @constructor
   */
  class Cursor {
    constructor (collection, query, projection) {
      this._query = query
      this._collection = collection
      this._projection = projection || query._projection
      this._operators = {}
      this._result = false
      this._position = 0
    }

    _fetch () {
      let self = this

      if (this._result !== false) {
        return this._result
      }

      // inject projection operator
      if (isObject(this._projection)) {
        Object.assign(this._operators, {'$project': this._projection})
      }

      if (!isArray(this._collection)) {
        err('Input collection is not of valid type. Must be an Array.')
      }

      // filter collection
      this._result = this._collection.filter(this._query.test, this._query)
      let pipeline = []

      each(['$sort', '$skip', '$limit', '$project'], op => {
        if (has(self._operators, op)) {
          let selected = {}
          selected[op] = self._operators[op]
          pipeline.push(selected)
        }
      })

      if (pipeline.length > 0) {
        let aggregator = new Mingo.Aggregator(pipeline)
        this._result = aggregator.run(this._result, this._query)
      }
      return this._result
    }

    /**
     * Fetch and return all matched results
     * @returns {Array}
     */
    all () {
      return this._fetch()
    }

    /**
     * Fetch and return the first matching result
     * @returns {Object}
     */
    first () {
      return this.count() > 0 ? this._fetch()[0] : null
    }

    /**
     * Fetch and return the last matching object from the result
     * @returns {Object}
     */
    last () {
      return this.count() > 0 ? this._fetch()[this.count() - 1] : null
    }

    /**
     * Counts the number of matched objects found
     * @returns {Number}
     */
    count () {
      return this._fetch().length
    }

    /**
     * Returns a cursor that begins returning results only after passing or skipping a number of documents.
     * @param {Number} n the number of results to skip.
     * @return {Mingo.Cursor} Returns the cursor, so you can chain this call.
     */
    skip (n) {
      Object.assign(this._operators, {'$skip': n})
      return this
    }

    /**
     * Constrains the size of a cursor's result set.
     * @param {Number} n the number of results to limit to.
     * @return {Mingo.Cursor} Returns the cursor, so you can chain this call.
     */
    limit (n) {
      Object.assign(this._operators, {'$limit': n})
      return this
    }

    /**
     * Returns results ordered according to a sort specification.
     * @param {Object} modifier an object of key and values specifying the sort order. 1 for ascending and -1 for descending
     * @return {Mingo.Cursor} Returns the cursor, so you can chain this call.
     */
    sort (modifier) {
      Object.assign(this._operators, {'$sort': modifier})
      return this
    }

    /**
     * Returns the next document in a cursor.
     * @returns {Object | Boolean}
     */
    next () {
      if (this.hasNext()) {
        return this._fetch()[this._position++]
      }
      return null
    }

    /**
     * Returns true if the cursor has documents and can be iterated.
     * @returns {boolean}
     */
    hasNext () {
      return this.count() > this._position
    }

    /**
     * Specifies the exclusive upper bound for a specific field
     * @param expr
     * @returns {Number}
     */
    max (expr) {
      return groupOperators.$max(this._fetch(), expr)
    }

    /**
     * Specifies the inclusive lower bound for a specific field
     * @param expr
     * @returns {Number}
     */
    min (expr) {
      return groupOperators.$min(this._fetch(), expr)
    }

    /**
     * Applies a function to each document in a cursor and collects the return values in an array.
     * @param callback
     * @returns {Array}
     */
    map (callback) {
      return this._fetch().map(callback)
    }

    /**
     * Applies a JavaScript function for every document in a cursor.
     * @param callback
     */
    forEach (callback) {
      this._fetch().forEach(callback)
    }
  }
  Mingo.Cursor = Cursor

  /**
   * Aggregator for defining filter using mongoDB aggregation pipeline syntax
   * @param operators an Array of pipeline operators
   * @constructor
   */
  class Aggregator {
    constructor (operators) {
      this._operators = operators
    }

    /**
     * Apply the pipeline operations over the collection by order of the sequence added
     * @param collection an array of objects to process
     * @param query the `Mingo.Query` object to use as context
     * @returns {Array}
     */
    run (collection, query) {
      if (!isEmpty(this._operators)) {
        // run aggregation pipeline
        for (let i = 0; i < this._operators.length; i++) {
          let operator = this._operators[i]
          let key = keys(operator)
          if (key.length === 1 && ops(OP_PIPELINE).includes(key[0])) {
            key = key[0]
            let opt = { pipelineOp: key }
            if (query instanceof Mingo.Query) {
              collection = pipelineOperators[key].call(query, collection, operator[key], opt)
            } else {
              collection = pipelineOperators[key](collection, operator[key], opt)
            }
          } else {
            err("Invalid aggregation operator '" + key + "'")
          }
        }
      }
      return collection
    }
  }
  Mingo.Aggregator = Aggregator

  /**
   * Performs a query on a collection and returns a cursor object.
   * @param collection
   * @param criteria
   * @param projection
   * @returns {Mingo.Cursor}
   */
  Mingo.find = (collection, criteria, projection) => (new Mingo.Query(criteria)).find(collection, projection)

  /**
   * Returns a new array without objects which match the criteria
   * @param collection
   * @param criteria
   * @returns {Array}
   */
  Mingo.remove = (collection, criteria) => (new Mingo.Query(criteria)).remove(collection)

  /**
   * Return the result collection after running the aggregation pipeline for the given collection
   * @param collection
   * @param pipeline
   * @returns {Array}
   */
  Mingo.aggregate = (collection, pipeline) => {
    if (!isArray(pipeline)) {
      err('Aggregation pipeline must be an array')
    }
    return (new Mingo.Aggregator(pipeline)).run(collection)
  }

  /**
   * Add new operators
   * @param opClass the operator class to extend
   * @param fn a function returning an object of new operators
   */
  Mingo.addOperators = (opClass, fn) => {
    let newOperators = fn(
      Object.assign({
        'idKey': () => settings.key
      }, Mingo._internal())
    )

    // ensure correct type specified
    assert(
      [OP_AGGREGATE, OP_GROUP, OP_PIPELINE, OP_PROJECTION, OP_QUERY].includes(opClass),
      `Could not identify operator class ${opClass}`
    )

    let operators = ops(opClass)

    // check for existing operators
    each(newOperators, (fn, op) => {
      assert(/^\$\w+$/.test(op), "Invalid operator name '" + op + "'")
      assert(!operators.includes(op), `Operator ${op} is already defined for ${opClass} operators`)
    })

    let wrapped = {}

    switch (opClass) {
      case OP_QUERY:
        each(newOperators, (fn, op) => {
          wrapped[op] = ((f, ctx, op) => {
            return (selector, value) => {
              return {
                test (obj) {
                  // value of field must be fully resolved.
                  let lhs = resolve(obj, selector)
                  let result = f.call(ctx, selector, lhs, value)
                  if (isBoolean(result)) {
                    return result
                  } else if (result instanceof Mingo.Query) {
                    return result.test(obj)
                  } else {
                    err(`Invalid return type for '${op}. Must return a Boolean or Mingo.Query`)
                  }
                }
              }
            }
          })(fn, newOperators, op)
        })
        break
      case OP_PROJECTION:
        each(newOperators, (fn, op) => {
          wrapped[op] = ((f, ctx) => {
            return (obj, expr, selector) => {
              let lhs = resolve(obj, selector)
              return f.call(ctx, selector, lhs, expr)
            }
          })(fn, newOperators)
        })
        break
      default:
        each(newOperators, (fn, op) => {
          wrapped[op] = ((f, ctx) => {
            return (...varargs) => {
              let args = arraySlice.call(varargs)
              return f.apply(ctx, args)
            }
          })(fn, newOperators)
        })
    }

    // toss the operator salad :)
    Object.assign(OPERATORS[opClass], wrapped)
  }

  /**
   * Mixin for Collection types that provide a method `toJSON() -> Array[Object]`
   */
  Mingo.CollectionMixin = {
    /**
     * Runs a query and returns a cursor to the result
     * @param criteria
     * @param projection
     * @returns {Mingo.Cursor}
     */
    query (criteria, projection) {
      return Mingo.find(this.toJSON(), criteria, projection)
    },

    /**
     * Runs the given aggregation operators on this collection
     * @params pipeline
     * @returns {Array}
     */
    aggregate (pipeline) {
      return Mingo.aggregate.call(null, this.toJSON(), pipeline)
    }
  }

  let pipelineOperators = {

    /**
     * Adds new fields to documents.
     * Outputs documents that contain all existing fields from the input documents and newly added fields.
     *
     * @param {Array} collection
     * @param {*} expr
     */
    $addFields (collection, expr) {
      let newFields = keys(expr)

      return collection.map(obj => {
        obj = clone(obj)

        each(newFields, selector => {
          let subExpr = expr[selector]
          let newValue

          if (isObject(subExpr)) {
            let subKeys = keys(subExpr)

            // check for any operators first
            let operator = subKeys.filter(k => k.indexOf('$') === 0)

            if (!isEmpty(operator)) {
              assert(subKeys.length === 1, 'Can have only one root operator in $addFields')
              operator = operator[0]
              subExpr = subExpr[operator]
              newValue = computeValue(obj, subExpr, operator)
            }
          } else {
            newValue = computeValue(obj, subExpr, null)
          }

          traverse(obj, selector, (o, key) => { o[key] = newValue }, true)
        })

        return obj
      })
    },

    /**
     * Groups documents together for the purpose of calculating aggregate values based on a collection of documents.
     *
     * @param collection
     * @param expr
     * @returns {Array}
     */
    $group (collection, expr) {
      // lookup key for grouping
      let idKey = expr[settings.key]

      let partitions = groupBy(collection, obj => computeValue(obj, idKey, idKey))

      let result = []

      // remove the group key
      delete expr[settings.key]

      each(partitions.keys, (value, i) => {
        let obj = {}

        // exclude undefined key value
        if (!isUndefined(value)) {
          obj[settings.key] = value
        }

        // compute remaining keys in expression
        for (let key in expr) {
          if (has(expr, key)) {
            obj[key] = accumulate(partitions.groups[i], key, expr[key])
          }
        }
        result.push(obj)
      })

      return result
    },

    /**
     * Filters the document stream, and only allows matching documents to pass into the next pipeline stage.
     * $match uses standard MongoDB queries.
     *
     * @param collection
     * @param expr
     * @returns {Array|*}
     */
    $match (collection, expr) {
      return (new Mingo.Query(expr)).find(collection).all()
    },

    /**
     * Reshapes a document stream.
     * $project can rename, add, or remove fields as well as create computed values and sub-documents.
     *
     * @param collection
     * @param expr
     * @returns {Array}
     */
    $project (collection, expr) {
      if (isEmpty(expr)) return collection

      // result collection
      let projected = []
      let objKeys = keys(expr)
      let idOnlyExcludedExpression = false

      // validate inclusion and exclusion
      let check = [false, false]
      for (let i = 0; i < objKeys.length; i++) {
        let k = objKeys[i]
        let v = expr[k]
        if (k === settings.key) continue
        if (v === 0 || v === false) {
          check[0] = true
        } else {
          check[1] = true
        }
        assert(check[0] !== check[1], 'Projection cannot have a mix of inclusion and exclusion.')
      }

      if (objKeys.includes(settings.key)) {
        let id = expr[settings.key]
        if (id === 0 || id === false) {
          objKeys = objKeys.filter(notInArray.bind(null, [settings.key]))
          assert(!objKeys.includes(settings.key), 'Must not contain collections _id')
          idOnlyExcludedExpression = isEmpty(objKeys)
        }
      } else {
        // if not specified the add the ID field
        objKeys.push(settings.key)
      }

      for (let i = 0; i < collection.length; i++) {
        let obj = collection[i]
        let cloneObj = {}
        let foundSlice = false
        let foundExclusion = false
        let dropKeys = []

        if (idOnlyExcludedExpression) {
          dropKeys.push(settings.key)
        }

        each(objKeys, key => {
          let subExpr = expr[key]
          let value // final computed value of the key
          let objValue // full object graph to value of the key

          if (key !== settings.key && subExpr === 0) {
            foundExclusion = true
          }

          if (key === settings.key && isEmpty(subExpr)) {
            // tiny optimization here to skip over id
            value = obj[key]
          } else if (isString(subExpr)) {
            value = computeValue(obj, subExpr, key)
          } else if (subExpr === 1 || subExpr === true) {
            // For direct projections, we use the resolved object value
          } else if (isObject(subExpr)) {
            let operator = keys(subExpr)
            operator = operator.length > 1 ? false : operator[0]

            if (ops(OP_PROJECTION).includes(operator)) {
              // apply the projection operator on the operator expression for the key
              if (operator === '$slice') {
                // $slice is handled differently for aggregation and projection operations
                if (coerceArray(subExpr[operator]).every(isNumber)) {
                  // $slice for projection operation
                  value = projectionOperators[operator](obj, subExpr[operator], key)
                  foundSlice = true
                } else {
                  // $slice for aggregation operation
                  value = computeValue(obj, subExpr, key)
                }
              } else {
                value = projectionOperators[operator](obj, subExpr[operator], key)
              }
            } else {
              // compute the value for the sub expression for the key
              value = computeValue(obj, subExpr, key)
            }
          } else {
            dropKeys.push(key)
            return
          }

          // clone resolved values
          value = clone(value)
          objValue = clone(resolveObj(obj, key))

          if (!isUndefined(objValue)) {
            if (!isUndefined(value)) {
              setValue(objValue, key, value)
            }
            Object.assign(cloneObj, objValue)
          } else if (!isUndefined(value)) {
            cloneObj[key] = value
          }
        })
        // if projection included $slice operator
        // Also if exclusion fields are found or we want to exclude only the id field
        // include keys that were not explicitly excluded
        if (foundSlice || foundExclusion || idOnlyExcludedExpression) {
          cloneObj = Object.assign(clone(obj), cloneObj)
          each(dropKeys, key => {
            removeValue(cloneObj, key)
          })
        }
        projected.push(cloneObj)
      }

      return projected
    },

    /**
     * Restricts the number of documents in an aggregation pipeline.
     *
     * @param collection
     * @param value
     * @returns {Object|*}
     */
    $limit (collection, value) {
      return collection.slice(0, value)
    },

    /**
     * Skips over a specified number of documents from the pipeline and returns the rest.
     *
     * @param collection
     * @param value
     * @returns {*}
     */
    $skip (collection, value) {
      return collection.slice(value)
    },

    /**
     * Takes an array of documents and returns them as a stream of documents.
     *
     * @param collection
     * @param expr
     * @returns {Array}
     */
    $unwind (collection, expr) {
      let result = []
      let field = expr.substr(1)
      for (let i = 0; i < collection.length; i++) {
        let obj = collection[i]
        // must throw an error if value is not an array
        let value = getValue(obj, field)
        if (isArray(value)) {
          each(value, item => {
            let tmp = clone(obj)
            tmp[field] = item
            result.push(tmp)
          })
        } else {
          err("Target field '" + field + "' is not of type Array.")
        }
      }
      return result
    },

    /**
     * Takes all input documents and returns them in a stream of sorted documents.
     *
     * @param collection
     * @param sortKeys
     * @returns {*}
     */
    $sort (collection, sortKeys) {
      if (!isEmpty(sortKeys) && isObject(sortKeys)) {
        let modifiers = keys(sortKeys)
        each(modifiers.reverse(), key => {
          let grouped = groupBy(collection, obj => resolve(obj, key))
          let sortedIndex = {}
          let findIndex = k => sortedIndex[hashcode(k)]

          let indexKeys = sortBy(grouped.keys, (item, i) => {
            sortedIndex[hashcode(item)] = i
            return item
          })

          if (sortKeys[key] === -1) {
            indexKeys.reverse()
          }
          collection = []
          each(indexKeys, item => {
            arrayPush.apply(collection, grouped.groups[findIndex(item)])
          })
        })
      }
      return collection
    },

    /**
     * Groups incoming documents based on the value of a specified expression,
     * then computes the count of documents in each distinct group.
     *
     * https://docs.mongodb.com/manual/reference/operator/aggregation/sortByCount/
     *
     * @param  {Array} collection
     * @param  {Object} expr
     * @return {*}
     */
    $sortByCount (collection, expr) {
      let newExpr = { count: { $sum: 1 } }
      newExpr[settings.key] = expr

      return this.$sort(
        this.$group(collection, newExpr),
        { count: -1 }
      )
    },

    /**
     * Randomly selects the specified number of documents from its input.
     * https://docs.mongodb.com/manual/reference/operator/aggregation/sample/
     *
     * @param  {Array} collection
     * @param  {Object} expr
     * @return {*}
     */
    $sample (collection, expr) {
      let size = expr['size']
      assert(isNumber(size),
      '$sample size must be a positive integer. See https://docs.mongodb.com/manual/reference/operator/aggregation/sample/')

      let result = []
      for (let i = 0; i < size; i++) {
        let n = Math.floor(Math.random() * collection.length)
        result.push(collection[n])
      }
      return result
    },

    /**
     * Returns a document that contains a count of the number of documents input to the stage.
     * @param  {Array} collection
     * @param  {String} expr
     * @return {Object}
     */
    $count (collection, expr) {
      assert(
        isString(expr) && expr.trim() !== '' && expr.indexOf('.') === -1 && expr.trim()[0] !== '$',
        'Invalid expression value for $count. See https://docs.mongodb.com/manual/reference/operator/aggregation/count/'
      )

      let result = {}
      result[expr] = collection.length
      return result
    },

    /**
     * Replaces a document with the specified embedded document or new one.
     * The replacement document can be any valid expression that resolves to a document.
     *
     * https://docs.mongodb.com/manual/reference/operator/aggregation/replaceRoot/
     *
     * @param  {Array} collection
     * @param  {Object} expr
     * @return {*}
     */
    $replaceRoot (collection, expr) {
      let newRoot = expr['newRoot']
      let result = []
      each(collection, obj => {
        obj = computeValue(obj, newRoot, null)
        assert(isObject(obj),
          '$replaceRoot expression must return a valid JS object. ' +
          'See https://docs.mongodb.com/manual/reference/operator/aggregation/replaceRoot/')
        result.push(obj)
      })
      return result
    },

    /**
     * Restricts the contents of the documents based on information stored in the documents themselves.
     *
     * https://docs.mongodb.com/manual/reference/operator/aggregation/redact/
     */
    $redact (collection, expr) {
      return collection.map(obj => redactObj(clone(obj), expr))
    }
  }

  // //////// QUERY OPERATORS //////////
  let queryOperators = {}

  let compoundOperators = {

    /**
     * Joins query clauses with a logical AND returns all documents that match the conditions of both clauses.
     *
     * @param selector
     * @param value
     * @returns {{test: Function}}
     */
    $and (selector, value) {
      assert(isArray(value), 'Invalid expression: $and expects value to be an Array')
      let queries = []
      each(value, expr => queries.push(new Mingo.Query(expr)))

      return {
        test (obj) {
          for (let i = 0; i < queries.length; i++) {
            if (!queries[i].test(obj)) {
              return false
            }
          }
          return true
        }
      }
    },

    /**
     * Joins query clauses with a logical OR returns all documents that match the conditions of either clause.
     *
     * @param selector
     * @param value
     * @returns {{test: Function}}
     */
    $or (selector, value) {
      if (!isArray(value)) {
        err('Invalid expression for $or criteria')
      }
      let queries = []

      each(value, expr => queries.push(new Mingo.Query(expr)))

      return {
        test (obj) {
          for (let i = 0; i < queries.length; i++) {
            if (queries[i].test(obj)) {
              return true
            }
          }
          return false
        }
      }
    },

    /**
     * Joins query clauses with a logical NOR returns all documents that fail to match both clauses.
     *
     * @param selector
     * @param value
     * @returns {{test: Function}}
     */
    $nor (selector, value) {
      if (!isArray(value)) {
        err('Invalid expression for $nor criteria')
      }
      let query = this.$or('$or', value)
      return {
        test (obj) {
          return !query.test(obj)
        }
      }
    },

    /**
     * Inverts the effect of a query expression and returns documents that do not match the query expression.
     *
     * @param selector
     * @param value
     * @returns {{test: Function}}
     */
    $not (selector, value) {
      let criteria = {
        [selector]: normalize(value)
      }
      let query = new Mingo.Query(criteria)
      return {
        test (obj) {
          return !query.test(obj)
        }
      }
    },

    /**
     * Matches documents that satisfy a JavaScript expression.
     *
     * @param selector
     * @param value
     * @returns {{test: test}}
     */
    $where (selector, value) {
      if (!isFunction(value)) {
        value = new Function(`return ${value};`)
      }
      return {
        test (obj) {
          return value.call(obj) === true
        }
      }
    }

  }

  // add compound query operators
  Object.assign(queryOperators, compoundOperators)

  let simpleOperators = {

    /**
     * Checks that two values are equal. Pseudo operator introduced for convenience and consistency
     *
     * @param a         The lhs operand as resolved from the object by the given selector
     * @param b         The rhs operand provided by the user
     * @returns {*}
     */
    $eq (a, b) {
      return isEqual(a, b) || (isArray(a) && a.findIndex(isEqual.bind(null, b)) !== -1)
    },

    /**
     * Matches all values that are not equal to the value specified in the query.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $ne (a, b) {
      return !this.$eq(a, b)
    },

    /**
     * Matches any of the values that exist in an array specified in the query.
     *
     * @param a
     * @param b
     * @returns {*}
     */
    $in (a, b) {
      a = coerceArray(a)
      return intersection(a, b).length > 0
    },

    /**
     * Matches values that do not exist in an array specified to the query.
     *
     * @param a
     * @param b
     * @returns {*|boolean}
     */
    $nin (a, b) {
      return isUndefined(a) || !this.$in(a, b)
    },

    /**
     * Matches values that are less than the value specified in the query.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $lt (a, b) {
      a = coerceArray(a).find(val => val < b)
      return a !== undefined
    },

    /**
     * Matches values that are less than or equal to the value specified in the query.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $lte (a, b) {
      a = coerceArray(a).find(val => val <= b)
      return a !== undefined
    },

    /**
     * Matches values that are greater than the value specified in the query.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $gt (a, b) {
      a = coerceArray(a).find(val => val > b)
      return a !== undefined
    },

    /**
     * Matches values that are greater than or equal to the value specified in the query.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $gte (a, b) {
      a = coerceArray(a).find(val => val >= b)
      return a !== undefined
    },

    /**
     * Performs a modulo operation on the value of a field and selects documents with a specified result.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $mod (a, b) {
      a = coerceArray(a).find(val => isNumber(val) && isArray(b) && b.length === 2 && (val % b[0]) === b[1])
      return a !== undefined
    },

    /**
     * Selects documents where values match a specified regular expression.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $regex (a, b) {
      a = coerceArray(a).find(val => {
        return isString(val) && isRegExp(b) && (!!val.match(b))
      })
      return a !== undefined
    },

    /**
     * Matches documents that have the specified field.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $exists (a, b) {
      return (b === false && isUndefined(a)) || (b === true && !isUndefined(a))
    },

    /**
     * Matches arrays that contain all elements specified in the query.
     *
     * @param a
     * @param b
     * @returns boolean
     */
    $all (a, b) {
      let self = this
      let matched = false
      if (isArray(a) && isArray(b)) {
        for (let i = 0; i < b.length; i++) {
          if (isObject(b[i]) && keys(b[i]).includes('$elemMatch')) {
            matched = matched || self.$elemMatch(a, b[i].$elemMatch)
          } else {
            // order of arguments matter
            return intersection(b, a).length === b.length
          }
        }
      }
      return matched
    },

    /**
     * Selects documents if the array field is a specified size.
     *
     * @param a
     * @param b
     * @returns {*|boolean}
     */
    $size (a, b) {
      return isArray(a) && isNumber(b) && (a.length === b)
    },

    /**
     * Selects documents if element in the array field matches all the specified $elemMatch condition.
     *
     * @param a
     * @param b
     */
    $elemMatch (a, b) {
      if (isArray(a) && !isEmpty(a)) {
        let query = new Mingo.Query(b)
        for (let i = 0; i < a.length; i++) {
          if (query.test(a[i])) {
            return true
          }
        }
      }
      return false
    },

    /**
     * Selects documents if a field is of the specified type.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $type (a, b) {
      switch (b) {
        case 1:
          return isNumber(a) && (a + '').indexOf('.') !== -1
        case 2:
        case 5:
          return isString(a)
        case 3:
          return isObject(a)
        case 4:
          return isArray(a)
        case 8:
          return isBoolean(a)
        case 9:
          return isDate(a)
        case 10:
          return isNull(a)
        case 11:
          return isRegExp(a)
        case 16:
          return isNumber(a) && a <= 2147483647 && (a + '').indexOf('.') === -1
        case 18:
          return isNumber(a) && a > 2147483647 && a <= 9223372036854775807 && (a + '').indexOf('.') === -1
        default:
          return false
      }
    }
  }
  // add simple query operators
  each(simpleOperators, (fn, op) => {
    queryOperators[op] = ((f, ctx) => {
      return (selector, value) => {
        return {
          test (obj) {
            // value of field must be fully resolved.
            let lhs = resolve(obj, selector)
            return f.call(ctx, lhs, value)
          }
        }
      }
    })(fn, simpleOperators)
  })

  let projectionOperators = {

    /**
     * Projects the first element in an array that matches the query condition.
     *
     * @param obj
     * @param field
     * @param expr
     */
    $ (obj, expr, field) {
      err('$ not implemented')
    },

    /**
     * Projects only the first element from an array that matches the specified $elemMatch condition.
     *
     * @param obj
     * @param field
     * @param expr
     * @returns {*}
     */
    $elemMatch (obj, expr, field) {
      let array = resolve(obj, field)
      let query = new Mingo.Query(expr)

      if (isUndefined(array) || !isArray(array)) {
        return undefined
      }

      for (let i = 0; i < array.length; i++) {
        if (query.test(array[i])) {
          return [array[i]]
        }
      }

      return undefined
    },

    /**
     * Limits the number of elements projected from an array. Supports skip and limit slices.
     *
     * @param obj
     * @param field
     * @param expr
     */
    $slice (obj, expr, field) {
      let xs = resolve(obj, field)

      if (!isArray(xs)) return xs

      if (isArray(expr)) {
        return slice(xs, expr[0], expr[1])
      } else if (isNumber(expr)) {
        return slice(xs, expr)
      } else {
        err('Invalid argument type for $slice projection operator')
      }
    },

    /**
     * Returns the population standard deviation of the input values.
     * @param  {Array} collection
     * @param  {Object} expr
     * @return {Number}
     */
    $stdDevPop (obj, expr, field) {
      let dataset = computeValue(obj, expr, field)
      return stddev({ dataset: dataset, sampled: false })
    },

    /**
     * Returns the sample standard deviation of the input values.
     * @param  {Array} collection
     * @param  {Object} expr
     * @return {Number|null}
     */
    $stdDevSamp (obj, expr, field) {
      let dataset = computeValue(obj, expr, field)
      return stddev({ dataset: dataset, sampled: true })
    }
  }

  let groupOperators = {

    /**
     * Returns an array of all the unique values for the selected field among for each document in that group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $addToSet (collection, expr) {
      return unique(this.$push(collection, expr))
    },

    /**
     * Returns the sum of all the values in a group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $sum (collection, expr) {
      if (!isArray(collection)) return 0

      if (isNumber(expr)) {
        // take a short cut if expr is number literal
        return collection.length * expr
      }
      return this.$push(collection, expr).filter(isNumber).reduce((acc, n) => acc + n, 0)
    },

    /**
     * Returns the highest value in a group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $max (collection, expr) {
      let mapped = this.$push(collection, expr)
      let max
      if (mapped.length > 0) {
        max = mapped[0]
        each(mapped, item => {
          if (item > max) max = item
        })
      }
      return max
    },

    /**
     * Returns the lowest value in a group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $min (collection, expr) {
      let mapped = this.$push(collection, expr)
      let min
      if (mapped.length > 0) {
        min = mapped[0]
        each(mapped, item => {
          if (item < min) min = item
        })
      }
      return min
    },

    /**
     * Returns an average of all the values in a group.
     *
     * @param collection
     * @param expr
     * @returns {number}
     */
    $avg (collection, expr) {
      let dataset = this.$push(collection, expr).filter(isNumber)
      let sum = dataset.reduce((acc, n) => acc + n, 0)
      return sum / (dataset.length || 1)
    },

    /**
     * Returns an array of all values for the selected field among for each document in that group.
     *
     * @param collection
     * @param expr
     * @returns {Array|*}
     */
    $push (collection, expr) {
      if (isUnknown(expr)) return clone(collection)

      return collection.map(obj => {
        return computeValue(obj, expr, null)
      })
    },

    /**
     * Returns the first value in a group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $first (collection, expr) {
      return (collection.length > 0) ? computeValue(collection[0], expr) : undefined
    },

    /**
     * Returns the last value in a group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $last (collection, expr) {
      return (collection.length > 0) ? computeValue(collection[collection.length - 1], expr) : undefined
    },

    /**
     * Returns the population standard deviation of the input values.
     * @param  {Array} collection
     * @param  {Object} expr
     * @return {Number}
     */
    $stdDevPop (collection, expr) {
      let dataset = this.$push(collection, expr).filter(isNumber)
      return stddev({ dataset: dataset, sampled: false })
    },

    /**
     * Returns the sample standard deviation of the input values.
     * @param  {Array} collection
     * @param  {Object} expr
     * @return {Number|null}
     */
    $stdDevSamp (collection, expr) {
      let dataset = this.$push(collection, expr).filter(isNumber)
      return stddev({ dataset: dataset, sampled: true })
    }
  }

  // ///////// Aggregation Operators ///////////

  let arithmeticOperators = {

    /**
     * Returns the absolute value of a number.
     * https://docs.mongodb.com/manual/reference/operator/aggregation/abs/#exp._S_abs
     * @param obj
     * @param expr
     * @return {Number|null|NaN}
     */
    $abs (obj, expr) {
      let val = computeValue(obj, expr, null)
      return (val === null || val === undefined) ? null : Math.abs(val)
    },

    /**
     * Computes the sum of an array of numbers.
     *
     * @param obj
     * @param expr
     * @returns {Object}
     */
    $add (obj, expr) {
      let args = computeValue(obj, expr, null)
      return args.reduce((memo, num) => memo + num, 0)
    },

    /**
     * Returns the smallest integer greater than or equal to the specified number.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $ceil (obj, expr) {
      let arg = computeValue(obj, expr, null)
      if (isNaN(arg)) return NaN
      if (isUnknown(arg)) return null
      assert(isNumber(arg), '$ceil must be a valid expression that resolves to a number.')
      return Math.ceil(arg)
    },

    /**
     * Takes two numbers and divides the first number by the second.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $divide (obj, expr) {
      let args = computeValue(obj, expr, null)
      return args[0] / args[1]
    },

    /**
     * Raises Euler’s number (i.e. e ) to the specified exponent and returns the result.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $exp (obj, expr) {
      let arg = computeValue(obj, expr, null)
      if (isNaN(arg)) return NaN
      if (isUnknown(arg)) return null
      assert(isNumber(arg), '$exp must be a valid expression that resolves to a number.')
      return Math.exp(arg)
    },

    /**
     * Returns the largest integer less than or equal to the specified number.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $floor (obj, expr) {
      let arg = computeValue(obj, expr, null)
      if (isNaN(arg)) return NaN
      if (isUnknown(arg)) return null
      assert(isNumber(arg), '$floor must be a valid expression that resolves to a number.')
      return Math.floor(arg)
    },

    /**
     * Calculates the natural logarithm ln (i.e loge) of a number and returns the result as a double.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $ln (obj, expr) {
      let arg = computeValue(obj, expr, null)
      if (isNaN(arg)) return NaN
      if (isUnknown(arg)) return null
      assert(isNumber(arg), '$ln must be a valid expression that resolves to a number.')
      return Math.log(arg)
    },

    /**
     * Calculates the log of a number in the specified base and returns the result as a double.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $log (obj, expr) {
      let args = computeValue(obj, expr, null)
      assert(isArray(args) && args.length === 2, '$log must be a valid expression that resolves to an array of 2 items')
      if (args.some(isNaN)) return NaN
      if (args.some(isUnknown)) return null
      assert(args.every(isNumber), '$log expression must resolve to array of 2 numbers')
      return Math.log10(args[0]) / Math.log10(args[1])
    },

    /**
     * Calculates the log base 10 of a number and returns the result as a double.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $log10 (obj, expr) {
      let arg = computeValue(obj, expr, null)
      if (isNaN(arg)) return NaN
      if (isUnknown(arg)) return null
      assert(isNumber(arg), '$log10 must be a valid expression that resolves to a number.')
      return Math.log10(arg)
    },

    /**
     * Takes two numbers and calculates the modulo of the first number divided by the second.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $mod (obj, expr) {
      let args = computeValue(obj, expr, null)
      return args[0] % args[1]
    },

    /**
     * Computes the product of an array of numbers.
     *
     * @param obj
     * @param expr
     * @returns {Object}
     */
    $multiply (obj, expr) {
      let args = computeValue(obj, expr, null)
      return args.reduce((memo, num) => memo * num, 1)
    },

    /**
     * Raises a number to the specified exponent and returns the result.
     *
     * @param obj
     * @param expr
     * @returns {Object}
     */
    $pow (obj, expr) {
      let args = computeValue(obj, expr, null)
      assert(isArray(args) && args.length === 2 && args.every(isNumber), '$pow must be a valid expression that resolves to an array of 2 numbers')

      if (args[0] === 0 && args[1] < 0) err('$pow cannot raise 0 to a negative exponent')

      return Math.pow(args[0], args[1])
    },

    /**
     * Calculates the square root of a positive number and returns the result as a double.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $sqrt (obj, expr) {
      let n = computeValue(obj, expr, null)
      if (isNaN(n)) return NaN
      if (isUnknown(n)) return null
      assert(isNumber(n) && n > 0, '$sqrt must be a valid expression that resolves to a non-negative number.')
      return Math.sqrt(n)
    },

    /**
     * Takes an array that contains two numbers or two dates and subtracts the second value from the first.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $subtract (obj, expr) {
      let args = computeValue(obj, expr, null)
      return args[0] - args[1]
    },

    /**
     * Truncates a number to its integer.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $trunc (obj, expr) {
      let n = computeValue(obj, expr, null)
      if (isNaN(n)) return NaN
      if (isUnknown(n)) return null
      assert(isNumber(n) && n > 0, '$trunc must be a valid expression that resolves to a non-negative number.')
      return Math.trunc(n)
    }
  }

  let stringOperators = {

    /**
     * Concatenates two strings.
     *
     * @param obj
     * @param expr
     * @returns {string|*}
     */
    $concat (obj, expr) {
      let args = computeValue(obj, expr, null)
      // does not allow concatenation with nulls
      if ([null, undefined].some(inArray.bind(null, args))) {
        return null
      }
      return args.join('')
    },

    /**
     * Searches a string for an occurence of a substring and returns the UTF-8 code point index of the first occurence.
     * If the substring is not found, returns -1.
     *
     * @param  {Object} obj
     * @param  {*} expr
     * @return {*}
     */
    $indexOfBytes (obj, expr) {
      let arr = computeValue(obj, expr, null)

      if (isUnknown(arr[0])) return null

      assert(isString(arr[0]), '$indexOfBytes first operand must resolve to a string')
      assert(isString(arr[1]), '$indexOfBytes second operand must resolve to a string')

      let str = arr[0]
      let searchStr = arr[1]
      let start = arr[2]
      let end = arr[3]

      assert(
        isUndefined(start) || (isNumber(start) && start >= 0 && Math.round(start) === start),
        '$indexOfBytes third operand must resolve to a non-negative integer'
      )
      start = start || 0

      assert(
        isUndefined(end) || (isNumber(end) && end >= 0 && Math.round(end) === end),
        '$indexOfBytes fourth operand must resolve to a non-negative integer'
      )
      end = end || str.length

      if (start > end) return -1

      let index = str.substring(start, end).indexOf(searchStr)
      return (index > -1)
        ? index + start
        : index
    },

    /**
     * Splits a string into substrings based on a delimiter.
     * If the delimiter is not found within the string, returns an array containing the original string.
     *
     * @param  {Object} obj
     * @param  {Array} expr
     * @return {Array} Returns an array of substrings.
     */
    $split (obj, expr) {
      let args = computeValue(obj, expr, null)
      assert(isString(args[0]), '$split requires an expression that evaluates to a string as a first argument, found: ' + type(args[0]))
      assert(isString(args[1]), '$split requires an expression that evaluates to a string as a second argument, found: ' + type(args[1]))
      return args[0].split(args[1])
    },

    /**
     * Compares two strings and returns an integer that reflects the comparison.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $strcasecmp (obj, expr) {
      let args = computeValue(obj, expr, null)
      args[0] = isEmpty(args[0]) ? '' : args[0].toUpperCase()
      args[1] = isEmpty(args[1]) ? '' : args[1].toUpperCase()
      if (args[0] > args[1]) {
        return 1
      }
      return (args[0] < args[1]) ? -1 : 0
    },

    /**
     * Returns a substring of a string, starting at a specified index position and including the specified number of characters.
     * The index is zero-based.
     *
     * @param obj
     * @param expr
     * @returns {string}
     */
    $substr (obj, expr) {
      let args = computeValue(obj, expr, null)
      if (isString(args[0])) {
        if (args[1] < 0) {
          return ''
        } else if (args[2] < 0) {
          return args[0].substr(args[1])
        } else {
          return args[0].substr(args[1], args[2])
        }
      }
      return ''
    },

    /**
     * Converts a string to lowercase.
     *
     * @param obj
     * @param expr
     * @returns {string}
     */
    $toLower (obj, expr) {
      let value = computeValue(obj, expr, null)
      return isEmpty(value) ? '' : value.toLowerCase()
    },

    /**
     * Converts a string to uppercase.
     *
     * @param obj
     * @param expr
     * @returns {string}
     */
    $toUpper (obj, expr) {
      let value = computeValue(obj, expr, null)
      return isEmpty(value) ? '' : value.toUpperCase()
    }
  }

  let dateOperators = {
    /**
     * Returns the day of the year for a date as a number between 1 and 366 (leap year).
     * @param obj
     * @param expr
     */
    $dayOfYear (obj, expr) {
      let d = computeValue(obj, expr, null)
      if (isDate(d)) {
        let start = new Date(d.getFullYear(), 0, 0)
        let diff = d - start
        let oneDay = 1000 * 60 * 60 * 24
        return Math.round(diff / oneDay)
      }
      return undefined
    },

    /**
     * Returns the day of the month for a date as a number between 1 and 31.
     * @param obj
     * @param expr
     */
    $dayOfMonth (obj, expr) {
      let d = computeValue(obj, expr, null)
      return isDate(d) ? d.getDate() : undefined
    },

    /**
     * Returns the day of the week for a date as a number between 1 (Sunday) and 7 (Saturday).
     * @param obj
     * @param expr
     */
    $dayOfWeek (obj, expr) {
      let d = computeValue(obj, expr, null)
      return isDate(d) ? d.getDay() + 1 : undefined
    },

    /**
     * Returns the year for a date as a number (e.g. 2014).
     * @param obj
     * @param expr
     */
    $year (obj, expr) {
      let d = computeValue(obj, expr, null)
      return isDate(d) ? d.getFullYear() : undefined
    },

    /**
     * Returns the month for a date as a number between 1 (January) and 12 (December).
     * @param obj
     * @param expr
     */
    $month (obj, expr) {
      let d = computeValue(obj, expr, null)
      return isDate(d) ? d.getMonth() + 1 : undefined
    },

    /**
     * Returns the week number for a date as a number between 0
     * (the partial week that precedes the first Sunday of the year) and 53 (leap year).
     * @param obj
     * @param expr
     */
    $week (obj, expr) {
      // source: http://stackoverflow.com/a/6117889/1370481
      let d = computeValue(obj, expr, null)

      // Copy date so don't modify original
      d = new Date(+d)
      d.setHours(0, 0, 0)
      // Set to nearest Thursday: current date + 4 - current day number
      // Make Sunday's day number 7
      d.setDate(d.getDate() + 4 - (d.getDay() || 7))
      // Get first day of year
      let yearStart = new Date(d.getFullYear(), 0, 1)
      // Calculate full weeks to nearest Thursday
      return Math.floor((((d - yearStart) / 8.64e7) + 1) / 7)
    },

    /**
     * Returns the hour for a date as a number between 0 and 23.
     * @param obj
     * @param expr
     */
    $hour (obj, expr) {
      let d = computeValue(obj, expr, null)
      return isDate(d) ? d.getUTCHours() : undefined
    },

    /**
     * Returns the minute for a date as a number between 0 and 59.
     * @param obj
     * @param expr
     */
    $minute (obj, expr) {
      let d = computeValue(obj, expr, null)
      return isDate(d) ? d.getMinutes() : undefined
    },

    /**
     * Returns the seconds for a date as a number between 0 and 60 (leap seconds).
     * @param obj
     * @param expr
     */
    $second (obj, expr) {
      let d = computeValue(obj, expr, null)
      return isDate(d) ? d.getSeconds() : undefined
    },

    /**
     * Returns the milliseconds of a date as a number between 0 and 999.
     * @param obj
     * @param expr
     */
    $millisecond (obj, expr) {
      let d = computeValue(obj, expr, null)
      return isDate(d) ? d.getMilliseconds() : undefined
    },

    /**
     * Returns the date as a formatted string.
     *
     * %Y  Year (4 digits, zero padded)  0000-9999
     * %m  Month (2 digits, zero padded)  01-12
     * %d  Day of Month (2 digits, zero padded)  01-31
     * %H  Hour (2 digits, zero padded, 24-hour clock)  00-23
     * %M  Minute (2 digits, zero padded)  00-59
     * %S  Second (2 digits, zero padded)  00-60
     * %L  Millisecond (3 digits, zero padded)  000-999
     * %j  Day of year (3 digits, zero padded)  001-366
     * %w  Day of week (1-Sunday, 7-Saturday)  1-7
     * %U  Week of year (2 digits, zero padded)  00-53
     * %%  Percent Character as a Literal  %
     *
     * @param obj current object
     * @param expr operator expression
     */
    $dateToString (obj, expr) {
      let fmt = expr['format']
      let date = computeValue(obj, expr['date'], null)
      let matches = fmt.match(/(%%|%Y|%m|%d|%H|%M|%S|%L|%j|%w|%U)/g)

      for (let i = 0, len = matches.length; i < len; i++) {
        let hdlr = DATE_SYM_TABLE[matches[i]]
        let value = hdlr

        if (isArray(hdlr)) {
          // reuse date operators
          let fn = this[hdlr[0]]
          let pad = hdlr[1]
          value = padDigits(fn.call(this, obj, date), pad)
        }
        // replace the match with resolved value
        fmt = fmt.replace(matches[i], value)
      }

      return fmt
    }
  }

  let setOperators = {
    /**
     * Returns true if two sets have the same elements.
     * @param obj
     * @param expr
     */
    $setEquals (obj, expr) {
      let args = computeValue(obj, expr, null)
      let xs = unique(args[0])
      let ys = unique(args[1])
      return xs.length === ys.length && xs.length === intersection(xs, ys).length
    },

    /**
     * Returns the common elements of the input sets.
     * @param obj
     * @param expr
     */
    $setIntersection (obj, expr) {
      let args = computeValue(obj, expr, null)
      return intersection(args[0], args[1])
    },

    /**
     * Returns elements of a set that do not appear in a second set.
     * @param obj
     * @param expr
     */
    $setDifference (obj, expr) {
      let args = computeValue(obj, expr, null)
      return args[0].filter(notInArray.bind(null, args[1]))
    },

    /**
     * Returns a set that holds all elements of the input sets.
     * @param obj
     * @param expr
     */
    $setUnion (obj, expr) {
      let args = computeValue(obj, expr, null)
      return union(args[0], args[1])
    },

    /**
     * Returns true if all elements of a set appear in a second set.
     * @param obj
     * @param expr
     */
    $setIsSubset (obj, expr) {
      let args = computeValue(obj, expr, null)
      return intersection(args[0], args[1]).length === args[0].length
    },

    /**
     * Returns true if any elements of a set evaluate to true, and false otherwise.
     * @param obj
     * @param expr
     */
    $anyElementTrue (obj, expr) {
      // mongodb nests the array expression in another
      let args = computeValue(obj, expr, null)[0]
      return args.some(truthy)
    },

    /**
     * Returns true if all elements of a set evaluate to true, and false otherwise.
     * @param obj
     * @param expr
     */
    $allElementsTrue (obj, expr) {
      // mongodb nests the array expression in another
      let args = computeValue(obj, expr, null)[0]
      return args.every(truthy)
    }
  }

  let conditionalOperators = {

    /**
     * A ternary operator that evaluates one expression,
     * and depending on the result returns the value of one following expressions.
     *
     * @param obj
     * @param expr
     */
    $cond (obj, expr) {
      let ifExpr, thenExpr, elseExpr
      if (isArray(expr)) {
        if (expr.length !== 3) {
          err('Invalid arguments for $cond operator')
        }
        ifExpr = expr[0]
        thenExpr = expr[1]
        elseExpr = expr[2]
      } else if (isObject(expr)) {
        ifExpr = expr['if']
        thenExpr = expr['then']
        elseExpr = expr['else']
      }
      let condition = computeValue(obj, ifExpr, null)
      return condition ? computeValue(obj, thenExpr, null) : computeValue(obj, elseExpr, null)
    },

    /**
     * An operator that evaluates a series of case expressions. When it finds an expression which
     * evaluates to true, it returns the resulting expression for that case. If none of the cases
     * evaluate to true, it returns the default expression.
     *
     * @param obj
     * @param expr
     */
    $switch (obj, expr) {
      if (!expr.branches) {
        err('Invalid arguments for $switch operator')
      }

      let validBranch = expr.branches.find(branch => {
        if (!(branch.case && branch.then)) {
          err('Invalid arguments for $switch operator')
        }
        return computeValue(obj, branch.case, null)
      })

      if (validBranch) {
        return computeValue(obj, validBranch.then, null)
      } else if (!expr.default) {
        err('Invalid arguments for $switch operator')
      } else {
        return computeValue(obj, expr.default, null)
      }
    },

    /**
     * Evaluates an expression and returns the first expression if it evaluates to a non-null value.
     * Otherwise, $ifNull returns the second expression's value.
     *
     * @param obj
     * @param expr
     * @returns {*}
     */
    $ifNull (obj, expr) {
      assert(isArray(expr) && expr.length === 2, 'Invalid arguments for $ifNull operator')
      let args = computeValue(obj, expr, null)
      return (args[0] === null || args[0] === undefined) ? args[1] : args[0]
    }
  }

  let comparisonOperators = {
    /**
     * Compares two values and returns the result of the comparison as an integer.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $cmp (obj, expr) {
      let args = computeValue(obj, expr, null)
      if (args[0] > args[1]) return 1
      if (args[0] < args[1]) return -1
      return 0
    }
  }
  // mixin comparison operators
  each(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin'], op => {
    comparisonOperators[op] = (obj, expr) => {
      let [lhs, rhs] = computeValue(obj, expr, null)
      return simpleOperators[op](lhs, rhs)
    }
  })

  let arrayOperators = {

    /**
     * Returns the element at the specified array index.
     *
     * @param  {Object} obj
     * @param  {*} expr
     * @return {*}
     */
    $arrayElemAt (obj, expr) {
      let arr = computeValue(obj, expr, null)
      assert(isArray(arr) && arr.length === 2, '$arrayElemAt expression must resolve to an array of 2 elements')
      assert(isArray(arr[0]), 'First operand to $arrayElemAt must resolve to an array')
      assert(isNumber(arr[1]), 'Second operand to $arrayElemAt must resolve to an integer')
      let idx = arr[1]
      arr = arr[0]
      if (idx < 0 && Math.abs(idx) <= arr.length) {
        return arr[idx + arr.length]
      } else if (idx >= 0 && idx < arr.length) {
        return arr[idx]
      }
      return undefined
    },

    /**
     * Concatenates arrays to return the concatenated array.
     *
     * @param  {Object} obj
     * @param  {*} expr
     * @return {*}
     */
    $concatArrays (obj, expr) {
      let arr = computeValue(obj, expr, null)
      assert(isArray(arr) && arr.length === 2, '$concatArrays expression must resolve to an array of 2 elements')

      if (arr.some(isUnknown)) return null

      return arr[0].concat(arr[1])
    },

    /**
     * Selects a subset of the array to return an array with only the elements that match the filter condition.
     *
     * @param  {Object} obj  [description]
     * @param  {*} expr [description]
     * @return {*}      [description]
     */
    $filter (obj, expr) {
      let input = computeValue(obj, expr['input'], null)
      let asVar = expr['as']
      let condExpr = expr['cond']

      assert(isArray(input), "'input' expression for $filter must resolve to an array")

      return input.filter(o => {
        // inject variable
        let tempObj = {}
        tempObj['$' + asVar] = o
        return computeValue(tempObj, condExpr, null) === true
      })
    },

    /**
     * Searches an array for an occurence of a specified value and returns the array index of the first occurence.
     * If the substring is not found, returns -1.
     *
     * @param  {Object} obj
     * @param  {*} expr
     * @return {*}
     */
    $indexOfArray (obj, expr) {
      let arr = computeValue(obj, expr, null)
      if (isUnknown(arr)) return null

      let array = arr[0]
      if (isUnknown(array)) return null

      assert(isArray(array), 'First operand for $indexOfArray must resolve to an array.')

      let searchValue = arr[1]
      if (isUnknown(searchValue)) return null

      let start = arr[2] || 0
      let end = arr[3] || array.length

      if (end < array.length) {
        array = array.slice(start, end)
      }

      return array.indexOf(searchValue, start)
    },

    /**
     * Determines if the operand is an array. Returns a boolean.
     *
     * @param  {Object}  obj
     * @param  {*}  expr
     * @return {Boolean}
     */
    $isArray (obj, expr) {
      return isArray(computeValue(obj, expr, null))
    },

    /**
     * Returns an array whose elements are a generated sequence of numbers.
     *
     * @param  {Object} obj
     * @param  {*} expr
     * @return {*}
     */
    $range (obj, expr) {
      let [start, end, step = 1] = computeValue(obj, expr, null)
      let result = []

      while (start < end && step > 0 || start > end && step < 0) {
        result.push(start)
        start += step
      }

      return result
    },

    /**
     * Returns an array with the elements in reverse order.
     *
     * @param  {Object} obj
     * @param  {*} expr
     * @return {*}
     */
    $reverseArray (obj, expr) {
      let arr = computeValue(obj, expr, null)

      if (isUnknown(arr)) return null
      assert(isArray(arr), '$reverseArray expression must resolve to an array')

      arr = clone(arr)
      arr.reverse()
      return arr
    },

    /**
     * Applies an expression to each element in an array and combines them into a single value.
     *
     * @param {Object} obj
     * @param {*} expr
     */
    $reduce (obj, expr) {
      let input = computeValue(obj, expr['input'], null)
      let initialValue = computeValue(obj, expr['initialValue'], null)
      let inExpr = expr['in']

      if (isUnknown(input)) return null
      assert(isArray(input), "'input' expression for $reduce must resolve to an array")

      return input.reduce((acc, n) => computeValue({ '$value': acc, '$this': n }, inExpr, null), initialValue)
    },

    /**
     * Counts and returns the total the number of items in an array.
     *
     * @param obj
     * @param expr
     */
    $size (obj, expr) {
      let value = computeValue(obj, expr, null)
      return isArray(value) ? value.length : undefined
    },

    /**
     * Returns a subset of an array.
     *
     * @param  {Object} obj
     * @param  {*} expr
     * @return {*}
     */
    $slice (obj, expr) {
      let arr = computeValue(obj, expr, null)
      return slice(clone(arr[0]), arr[1], arr[2])
    },

    /**
     * Merge two lists together.
     *
     * Transposes an array of input arrays so that the first element of the output array would be an array containing,
     * the first element of the first input array, the first element of the second input array, etc.
     *
     * @param  {Obj} obj
     * @param  {*} expr
     * @return {*}
     */
    $zip (obj, expr) {
      let inputs = computeValue(obj, expr.inputs, null)
      let useLongestLength = expr.useLongestLength || false

      assert(isArray(inputs), "'inputs' expression must resolve to an array")
      assert(isBoolean(useLongestLength), "'useLongestLength' must be a boolean")

      if (isArray(expr.defaults)) {
        assert(truthy(useLongestLength), "'useLongestLength' must be set to true to use 'defaults'")
      }

      let len = 0
      let arr // temp variable
      let i // loop counter

      for (i = 0; i < inputs.length; i++) {
        arr = inputs[i]

        if (isUnknown(arr)) return null
        assert(isArray(arr), "'inputs' expression values must resolve to an array or null")

        len = useLongestLength
          ? Math.max(len, arr.length)
          : Math.min(len || arr.length, arr.length)
      }

      let result = []
      let defaults = expr.defaults || []

      for (i = 0; i < len; i++) {
        arr = inputs.map((val, index) => {
          return isUnknown(val[i])
            ? (defaults[index] || null)
            : val[i]
        })
        result.push(arr)
      }

      return result
    }
  }

  let literalOperators = {
    /**
     * Return a value without parsing.
     * @param obj
     * @param expr
     */
    $literal (obj, expr) {
      return expr
    }
  }

  let variableOperators = {
    /**
     * Applies a subexpression to each element of an array and returns the array of resulting values in order.
     * @param obj
     * @param expr
     * @returns {Array|*}
     */
    $map (obj, expr) {
      let inputExpr = computeValue(obj, expr['input'], null)
      if (!isArray(inputExpr)) {
        err('Input expression for $map must resolve to an array')
      }
      let asExpr = expr['as']
      let inExpr = expr['in']

      // HACK: add the "as" expression as a value on the object to take advantage of "resolve()"
      // which will reduce to that value when invoked. The reference to the as expression will be prefixed with "$$".
      // But since a "$" is stripped of before passing the name to "resolve()" we just need to prepend "$" to the key.
      let tempKey = '$' + asExpr
      // let's save any value that existed, kinda useless but YOU CAN NEVER BE TOO SURE, CAN YOU :)
      let original = obj[tempKey]
      return inputExpr.map(item => {
        obj[tempKey] = item
        let value = computeValue(obj, inExpr, null)
        // cleanup and restore
        if (isUndefined(original)) {
          delete obj[tempKey]
        } else {
          obj[tempKey] = original
        }
        return value
      })
    },

    /**
     * Defines variables for use within the scope of a subexpression and returns the result of the subexpression.
     * @param obj
     * @param expr
     * @returns {*}
     */
    $let (obj, expr) {
      let varsExpr = expr['vars']
      let inExpr = expr['in']

      // resolve vars
      let originals = {}
      let varsKeys = keys(varsExpr)
      each(varsKeys, key => {
        let val = computeValue(obj, varsExpr[key], null)
        let tempKey = '$' + key
        // set value on object using same technique as in "$map"
        originals[tempKey] = obj[tempKey]
        obj[tempKey] = val
      })

      let value = computeValue(obj, inExpr, null)

      // cleanup and restore
      each(varsKeys, key => {
        let tempKey = '$' + key
        if (isUndefined(originals[tempKey])) {
          delete obj[tempKey]
        } else {
          obj[tempKey] = originals[tempKey]
        }
      })

      return value
    }
  }

  let booleanOperators = {
    /**
     * Returns true only when all its expressions evaluate to true. Accepts any number of argument expressions.
     * @param obj
     * @param expr
     * @returns {boolean}
     */
    $and (obj, expr) {
      let value = computeValue(obj, expr, null)
      return truthy(value) && value.every(truthy)
    },

    /**
     * Returns true when any of its expressions evaluates to true. Accepts any number of argument expressions.
     * @param obj
     * @param expr
     * @returns {boolean}
     */
    $or (obj, expr) {
      let value = computeValue(obj, expr, null)
      return truthy(value) && value.some(truthy)
    },

    /**
     * Returns the boolean value that is the opposite of its argument expression. Accepts a single argument expression.
     * @param obj
     * @param expr
     * @returns {boolean}
     */
    $not (obj, expr) {
      return !computeValue(obj, expr[0], null)
    }
  }

  // combine aggregate operators
  let aggregateOperators = Object.assign(
    {},
    arrayOperators,
    arithmeticOperators,
    booleanOperators,
    comparisonOperators,
    conditionalOperators,
    dateOperators,
    literalOperators,
    setOperators,
    stringOperators,
    variableOperators
  )

  /**
   * Implementation of system variables
   * @type {Object}
   */
  let systemVariables = {
    '$$ROOT' (obj, expr, opt) { return opt.root },
    '$$CURRENT' (obj, expr, opt) { return obj }
  }

  /**
   * Implementation of $redact variables
   * @type {Object}
   */
  let redactVariables = {
    '$$KEEP' (obj, expr, opt) { return obj },
    '$$PRUNE' (obj, expr, opt) { return undefined },
    '$$DESCEND' (obj, expr, opt) {
      // traverse nested documents iff there is a $cond
      if (!has(expr, '$cond')) return obj

      let result

      each(obj, (current, key) => {
        if (isObjectLike(current)) {
          if (isArray(current)) {
            result = []
            each(current, (elem, index) => {
              if (isObject(elem)) {
                elem = redactObj(elem, expr, opt)
              }
              if (!isUndefined(elem)) result.push(elem)
            })
          } else {
            result = redactObj(current, expr, opt)
          }

          if (isUndefined(result)) {
            delete obj[key] // pruned result
          } else {
            obj[key] = result
          }
        }
      })
      return obj
    }
  }

  // system varibiables
  let SYS_VARS = keys(systemVariables)
  let REDACT_VARS = keys(redactVariables)

  let OP_QUERY = Mingo.OP_QUERY = 'query'
  let OP_GROUP = Mingo.OP_GROUP = 'group'
  let OP_AGGREGATE = Mingo.OP_AGGREGATE = 'aggregate'
  let OP_PIPELINE = Mingo.OP_PIPELINE = 'pipeline'
  let OP_PROJECTION = Mingo.OP_PROJECTION = 'projection'

  // operator definitions
  let OPERATORS = {
    'aggregate': aggregateOperators,
    'group': groupOperators,
    'pipeline': pipelineOperators,
    'projection': projectionOperators,
    'query': queryOperators
  }

  // used for formatting dates in $dateToString operator
  let DATE_SYM_TABLE = {
    '%Y': ['$year', 4],
    '%m': ['$month', 2],
    '%d': ['$dayOfMonth', 2],
    '%H': ['$hour', 2],
    '%M': ['$minute', 2],
    '%S': ['$second', 2],
    '%L': ['$millisecond', 3],
    '%j': ['$dayOfYear', 3],
    '%w': ['$dayOfWeek', 1],
    '%U': ['$week', 2],
    '%%': '%'
  }

  /**
   * Redact an object
   * @param  {Object} obj The object to redact
   * @param  {*} expr The redact expression
   * @param  {*} opt  Options for value
   * @return {*} Returns the redacted value
   */
  function redactObj (obj, expr, opt) {
    opt = opt || {}
    opt.root = opt.root || clone(obj)

    let result = computeValue(obj, expr, null, opt)
    return REDACT_VARS.includes(result)
      ? redactVariables[result](obj, expr, opt)
      : result
  }

  /**
   * Retrieve the value of a given key on an object
   * @param obj
   * @param field
   * @returns {*}
   * @private
   */
  function getValue (obj, field) {
    return obj[field]
  }

  /**
   * Resolve the value of the field (dot separated) on the given object
   * @param obj {Object} the object context
   * @param selector {String} dot separated path to field
   * @returns {*}
   */
  function resolve (obj, selector, deepFlag) {
    let names = selector.split('.')
    let value = obj

    for (let i = 0; i < names.length; i++) {
      let isText = isNull(names[i].match(/^\d+$/))

      if (isText && isArray(value)) {
        // On the first iteration, we check if we received a stop flag.
        // If so, we stop to prevent iterating over a nested array value
        // on consecutive object keys in the selector.
        if (deepFlag === true && i === 0) {
          return value
        }

        value = value.map(item => {
          return resolve(item, names[i], true)
        })

        // we unwrap for arrays of unit length
        // this avoids excess wrapping when resolving deeply nested arrays
        if (value.length === 1) {
          value = value[0]
        }
      } else {
        value = getValue(value, names[i])
        deepFlag = false // reset stop flag when we do a direct lookup
      }

      if (isUndefined(value)) break
    }

    return value
  }

  /**
   * Returns the full object to the resolved value given by the selector.
   * This function excludes empty values as they aren't practically useful.
   *
   * @param obj {Object} the object context
   * @param selector {String} dot separated path to field
   */
  function resolveObj (obj, selector) {
    if (isUndefined(obj)) return

    let names = selector.split('.')
    let key = names[0]
    // get the next part of the selector
    let next = names.length === 1 || names.slice(1).join('.')
    let isIndex = key.match(/^\d+$/) !== null
    let result
    let val

    try {
      if (names.length === 1) {
        if (isArray(obj)) {
          if (isIndex) {
            result = getValue(obj, key)
            assertExists(result)
            result = [result]
          } else {
            result = []
            each(obj, item => {
              val = resolveObj(item, selector)
              if (!isUndefined(val)) result.push(val)
            })
            assert(result.length > 0)
          }
        } else {
          val = getValue(obj, key)
          assertExists(val)
          result = {}
          result[key] = val
        }
      } else {
        if (isArray(obj)) {
          if (isIndex) {
            result = getValue(obj, key)
            result = resolveObj(result, next)
            assertExists(result)
            result = [result]
          } else {
            result = []
            each(obj, item => {
              val = resolveObj(item, selector)
              if (!isUndefined(val)) result.push(val)
            })
            assert(result.length > 0)
          }
        } else {
          val = getValue(obj, key)
          val = resolveObj(val, next)
          assertExists(val)
          result = {}
          result[key] = val
        }
      }
    } catch (e) {
      result = undefined
    }

    return result
  }

  /**
   * Walk the object graph and execute the given transform function
   * @param  {Object|Array} obj   The object to traverse
   * @param  {String} selector    The selector
   * @param  {Function} transformFn Function to execute for value at the end the traversal
   * @param  {Boolean} force Force generating missing parts of object graph
   * @return {*}
   */
  function traverse (obj, selector, fn, force) {
    let names = selector.split('.')
    let key = names[0]
    let next = names.length === 1 || names.slice(1).join('.')
    let isIndex = /^\d+$/.test(key)

    if (names.length === 1) {
      fn(obj, key)
    } else { // nested objects
      if (isArray(obj) && !isIndex) {
        each(obj, item => traverse(item, selector, fn, force))
      } else {
        // force the rest of the graph while traversing
        if (force === true) {
          let exists = has(obj, key)
          if (!exists || isUnknown(obj[key])) {
            obj[key] = {}
          }
        }
        traverse(obj[key], next, fn, force)
      }
    }
  }

  /**
   * Set the value of the given object field
   *
   * @param obj {Object|Array} the object context
   * @param selector {String} path to field
   * @param value {*} the value to set
   */
  function setValue (obj, selector, value) {
    traverse(obj, selector, (item, key) => { item[key] = value })
  }

  function removeValue (obj, selector) {
    traverse(obj, selector, (item, key) => {
      if (isArray(item) && /^\d+$/.test(key)) {
        item.splice(parseInt(key), 1)
      } else if (isObject(item)) {
        delete item[key]
      }
    })
  }

  /**
   * Deep clone an object
   */
  function clone (arg) {
    switch (type(arg)) {
      case 'array':
        return arg.map(clone)
      case 'object':
        return map(arg, clone)
      default:
        return arg
    }
  }

  // quick reference for
  let primitives = [
    isString, isBoolean, isNumber, isDate, isUnknown, isRegExp
  ]

  function isPrimitive (value) {
    for (let i = 0; i < primitives.length; i++) {
      if (primitives[i](value)) {
        return true
      }
    }
    return false
  }

  // primitives and user-defined types
  function isSimpleType (value) {
    return isPrimitive(value) || !isObjectLike(value)
  }

  /**
   * Simplify expression for easy evaluation with query operators map
   * @param expr
   * @returns {*}
   */
  function normalize (expr) {
    // normalized primitives
    if (isSimpleType(expr)) {
      return isRegExp(expr) ? {'$regex': expr} : {'$eq': expr}
    }

    // normalize object expression
    if (isObjectLike(expr)) {
      let exprKeys = keys(expr)
      let notQuery = intersection(ops(OP_QUERY), exprKeys).length === 0

      // no valid query operator found, so we do simple comparison
      if (notQuery) {
        return {'$eq': expr}
      }

      // ensure valid regex
      if (exprKeys.includes('$regex')) {
        let regex = expr['$regex']
        let options = expr['$options'] || ''
        let modifiers = ''
        if (isString(regex)) {
          modifiers += (regex.ignoreCase || options.indexOf('i') >= 0) ? 'i' : ''
          modifiers += (regex.multiline || options.indexOf('m') >= 0) ? 'm' : ''
          modifiers += (regex.global || options.indexOf('g') >= 0) ? 'g' : ''
          regex = new RegExp(regex, modifiers)
        }
        expr['$regex'] = regex
        delete expr['$options']
      }
    }

    return expr
  }

  function padDigits (number, digits) {
    return new Array(Math.max(digits - String(number).length + 1, 0)).join('0') + number
  }

  /**
   * Return the registered operators on the given operator category
   * @param type catgory of operators
   * @returns {*}
   */
  function ops (type) {
    return keys(OPERATORS[type])
  }

  /**
   * Returns a (stably) sorted copy of list, ranked in ascending order by the results of running each value through iteratee
   * @param  {Array}   collection [description]
   * @param  {Function} fn The function used to sort
   * @return {Array} Returns a new sorted array by the given iteratee
   */
  function sortBy (collection, fn, ctx) {
    let sortKeys = {}
    let sorted = []
    let key
    let val
    let hash
    let len = collection.length
    for (let i = 0; i < len; i++) {
      val = collection[i]
      key = fn.call(ctx, val, i)
      hash = hashcode(val)
      if (!has(sortKeys, hash)) {
        sortKeys[hash] = [key, i]
      }
      sorted.push(clone(val))
    }
    // use native array sorting but enforce stableness
    sorted.sort((a, b) => {
      let A = sortKeys[hashcode(a)]
      let B = sortKeys[hashcode(b)]
      if (A[0] < B[0]) return -1
      if (A[0] > B[0]) return 1
      if (A[1] < B[1]) return -1
      if (A[1] > B[1]) return 1
      return 0
    })
    assert(sorted.length === collection.length, 'sortBy must retain collection length')
    return sorted
  }

  /**
   * Groups the collection into sets by the returned key
   *
   * @param collection
   * @param fn {function} to compute the group key of an item in the collection
   */
  function groupBy (collection, fn, ctx) {
    let result = {
      'keys': [],
      'groups': []
    }

    let lookup = {}

    each(collection, obj => {
      let key = fn.call(ctx, obj)
      let hash = hashcode(key)
      let index = -1

      if (isUndefined(lookup[hash])) {
        index = result.keys.length
        lookup[hash] = index
        result.keys.push(key)
        result.groups.push([])
      }
      index = lookup[hash]
      result.groups[index].push(obj)
    })

    assert(result.keys.length === result.groups.length, 'Cardinality must be equal for groups and keys')
    return result
  }

  // encode value using a simple optimistic scheme
  function encode (value) {
    return stringify({'': value}) + type(value) + value
  }

  // http://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript-jquery
  // http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
  function hashcode (value) {
    let i, chr, len
    let hash = 0
    let s = encode(value)
    if (s.length === 0) return hash
    for (i = 0, len = s.length; i < len; i++) {
      chr = s.charCodeAt(i)
      hash = ((hash << 5) - hash) + chr
      hash |= 0 // Convert to 32bit integer
    }
    return hash.toString()
  }

  /**
   * Returns the result of evaluating a $group operation over a collection
   *
   * @param collection
   * @param field the name of the aggregate operator or field
   * @param expr the expression of the aggregate operator for the field
   * @returns {*}
   */
  function accumulate (collection, field, expr) {
    if (ops(OP_GROUP).includes(field)) {
      return groupOperators[field](collection, expr)
    }

    if (isObject(expr)) {
      let result = {}
      for (let key in expr) {
        if (has(expr, key)) {
          result[key] = accumulate(collection, key, expr[key])
          // must run ONLY one group operator per expression
          // if so, return result of the computed value
          if (ops(OP_GROUP).includes(key)) {
            result = result[key]
            // if there are more keys in expression this is bad
            if (keys(expr).length > 1) {
              err("Invalid $group expression '" + stringify(expr) + "'")
            }
            break
          }
        }
      }
      return result
    }

    return undefined
  }

  /**
   * Computes the actual value of the expression using the given object as context
   *
   * @param obj the current object from the collection
   * @param expr the expression for the given field
   * @param field the field name (may also be an aggregate operator)
   * @returns {*}
   */
  function computeValue (obj, expr, field, opt) {
    opt = opt || {}
    opt.root = opt.root || clone(obj)

    // if the field of the object is a valid operator
    if (ops(OP_AGGREGATE).includes(field)) {
      return aggregateOperators[field](obj, expr, opt)
    }

    // we also handle $group accumulator operators
    if (ops(OP_GROUP).includes(field)) {
      // we first fully resolve the expression
      obj = computeValue(obj, expr, null, opt)
      assert(isArray(obj), 'Must use collection type with ' + field + ' operator')
      // we pass a null expression because all values have been resolved
      return groupOperators[field](obj, null, opt)
    }

    // if expr is a variable for an object field
    // field not used in this case
    if (isString(expr) && expr.length > 0 && expr[0] === '$') {
      // we return system variables as literals
      if (SYS_VARS.includes(expr)) {
        return systemVariables[expr](obj, null, opt)
      } else if (REDACT_VARS.includes(expr)) {
        return expr
      }

      // handle selectors with explicit prefix
      let sysVar = SYS_VARS.filter(v => { return expr.indexOf(v + '.') === 0 })
      if (sysVar.length === 1) {
        sysVar = sysVar[0]
        if (sysVar === '$$ROOT') {
          obj = opt.root
        }
        expr = expr.substr(sysVar.length) // '.' prefix will be sliced off below
      }

      return resolve(obj, expr.slice(1))
    }

    // check and return value if already in a resolved state
    switch (type(expr)) {
      case 'array':
        return expr.map(item => {
          return computeValue(obj, item, null)
        })
      case 'object':
        let result = {}
        for (let key in expr) {
          if (has(expr, key)) {
            result[key] = computeValue(obj, expr[key], key, opt)
            // must run ONLY one aggregate operator per expression
            // if so, return result of the computed value
            if (ops(OP_AGGREGATE).includes(key)) {
              // there should be only one operator
              assert(keys(expr).length === 1, "Invalid aggregation expression '" + stringify(expr) + "'")
              result = result[key]
              break
            }
          }
        }
        return result
      default:
        return clone(expr)
    }
  }

  function assert (condition, message) {
    if (falsey(condition)) err(message)
  }

  function assertExists (value) {
    return assert(!isUndefined(value))
  }

  function assertObjectLike (o, message) {
    assert(o === Object(o), message)
  }

  function isType (v, n) { return type(v) === n }
  function isBoolean (v) { return isType(v, 'boolean') }
  function isString (v) { return isType(v, 'string') }
  function isNumber (v) { return isType(v, 'number') }
  function isArray (v) { return isType(v, 'array') }
  function isObject (v) { return isType(v, 'object') }
  function isObjectLike (v) { return v === Object(v) } // objects, arrays, functions
  function isDate (v) { return isType(v, 'date') }
  function isRegExp (v, t) { return isType(v, 'regexp') }
  function isFunction (v, t) { return isType(v, 'function') }
  function isNull (v) { return isType(v, 'null') }
  function isUndefined (v) { return isType(v, 'undefined') }
  function isUnknown (v) { return isNull(v) || isUndefined(v) }
  function notInArray (arr, item) { return !arr.includes(item) }
  function inArray (arr, item) { return arr.includes(item) }
  function truthy (arg) { return !!arg }
  function falsey (arg) { return !arg }
  function isEmpty (x) {
    return isUnknown(x) ||
      isArray(x) && x.length === 0 ||
      isObject(x) && keys(x).length === 0 ||
      !x
  }
  function coerceArray (x) { return isArray(x) ? x : [x] }
  function type (value) { return Object.prototype.toString.call(value).match(/\s(\w+)/)[1].toLowerCase() }
  function has (obj, prop) { return Object.prototype.hasOwnProperty.call(obj, prop) }
  function err (s) { throw new Error(s) }
  function keys (o) { return Object.keys(o) }

  // ////////////////// UTILS ////////////////////

  /**
   * Iterate over an array or object
   * @param  {Array|Object} obj An object-like value
   * @param  {Function} callback The callback to run per item
   * @param  {*}   ctx  The object to use a context
   * @return {void}
   */
  function each (obj, callback, ctx) {
    assertObjectLike(obj, "Cannot iterate over object of type '" + type(obj) + "'")
    if (isArray(obj)) {
      obj.forEach(callback, ctx)
    } else {
      for (let k in obj) {
        if (has(obj, k)) {
          callback.call(ctx, obj[k], k)
        }
      }
    }
  }

  /**
   * Transform values in a collection
   *
   * @param  {Array|Object}   obj   An array/object whose values to transform
   * @param  {Function} callback The transform function
   * @param  {*}   ctx The value to use as the "this" context for the transform
   * @return {Array|Object} Result object after applying the transform
   */
  function map (obj, callback, ctx) {
    if (isArray(obj)) {
      return obj.map(callback, ctx)
    } else if (isObject(obj)) {
      let o = {}
      let arr = keys(obj)
      for (let k, i = 0, len = arr.length; i < len; i++) {
        k = arr[i]
        o[k] = callback.call(ctx, obj[k], k)
      }
      return o
    }
    err('Input must be an Array or Object type')
  }

  /**
   * Returns the intersection between two arrays
   *
   * @param  {Array} xs The first array
   * @param  {Array} ys The second array
   * @return {Array}    Result array
   */
  function intersection (xs, ys) {
    return xs.filter(inArray.bind(null, ys))
  }

  /**
   * Returns the union of two arrays
   *
   * @param  {Array} xs The first array
   * @param  {Array} ys The second array
   * @return {Array}   The result array
   */
  function union (xs, ys) {
    let arr = []
    arrayPush.apply(arr, xs)
    arrayPush.apply(arr, ys.filter(notInArray.bind(null, xs)))
    return arr
  }

  /**
   * Flatten the array
   *
   * @param  {Array} xs The array to flatten
   * @return {Array} depth The number of nested lists to interate
   */
  function flatten (xs, depth) {
    assert(isArray(xs), 'Input must be an Array')
    let arr = []
    let unwrap = (ys, iter) => {
      for (let i = 0, len = ys.length; i < len; i++) {
        if (isArray(ys[i]) && (iter > 0 || iter < 0)) {
          unwrap(ys[i], Math.max(-1, iter - 1))
        } else {
          arrayPush.call(arr, ys[i])
        }
      }
    }
    unwrap(xs, depth || -1)
    return arr
  }

  /**
   * Determine whether two values are the same or strictly equivalent
   *
   * @param  {*}  a The first value
   * @param  {*}  b The second value
   * @return {Boolean}   Result of comparison
   */
  function isEqual (a, b) {
    // strictly equal must be equal.
    if (a === b) return true

    // unequal types cannot be equal.
    let vtype = type(a)
    if (vtype !== type(b)) return false

    // we treat NaN as the same
    if (vtype === 'number' && isNaN(a) && isNaN(b)) return true

    // leverage toString for Date and RegExp types
    if (['date', 'regexp'].includes(vtype)) return a.toString() === b.toString()

    let i // loop counter
    let len // loop length

    if (vtype === 'array') {
      if (a.length === b.length && a.length === 0) return true
      if (a.length !== b.length) return false
      for (i = 0, len = a.length; i < len; i++) {
        if (!isEqual(a[i], b[i])) return false
      }
    } else if ([a, b].every(isObject)) {
      // deep compare objects
      let ka = keys(a)
      let kb = keys(b)

      // check length of keys early
      if (ka.length !== kb.length) return false

      // we know keys are strings so we sort before comparing
      ka.sort()
      kb.sort()

      // compare keys
      if (!isEqual(ka, kb)) return false

      // back to the drawing board
      for (i = 0, len = ka.length; i < len; i++) {
        let temp = ka[i]
        if (!isEqual(a[temp], b[temp])) return false
      }
    } else {
      // we do not know how to compare unknown types
      return false
    }
    // best effort says values are equal :)
    return true
  }

  /**
   * Return a new unique version of the collection
   * @param  {Array} xs The input collection
   * @return {Array}    A new collection with unique values
   */
  function unique (xs) {
    let h = {}
    let arr = []
    each(xs, item => {
      let k = hashcode(item)
      if (!has(h, k)) {
        arr.push(item)
        h[k] = 0
      }
    })
    return arr
  }

  /**
   * Compute the standard deviation of the dataset
   * @param  {Object} ctx An object of the context. Includes "dataset:Array" and "sampled:Boolean".
   * @return {Number}
   */
  function stddev ({dataset, sampled = false}) {
    let sum = dataset.reduce((acc, n) => acc + n, 0)
    let N = dataset.length || 1
    let err = sampled === true ? 1 : 0
    let avg = sum / (N - err)
    return Math.sqrt(dataset.reduce((acc, n) => acc + Math.pow(n - avg, 2), 0) / N)
  }

  /**
   * Returns a slice of the array
   *
   * @param  {Array} xs
   * @param  {Number} skip
   * @param  {Number} limit
   * @return {Array}
   */
  function slice (xs, skip, limit) {
    // MongoDB $slice works a bit differently from Array.slice
    // Uses single argument for 'limit' and array argument [skip, limit]
    if (isUnknown(limit)) {
      if (skip < 0) {
        skip = Math.max(0, xs.length + skip)
        limit = xs.length - skip + 1
      } else {
        limit = skip
        skip = 0
      }
    } else {
      if (skip < 0) {
        skip = Math.max(0, xs.length + skip)
      }
      assert(limit > 0, 'Invalid argument value for $slice operator. Limit must be a positive number')
      limit += skip
    }
    return arraySlice.apply(xs, [skip, limit])
  }

  Mingo.VERSION = VERSION
})(this)
