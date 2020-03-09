import { computed, Lambda, observable, runInAction, transaction } from 'mobx'
import { Observable, Subscription } from 'rxjs'

type Dictionary<T> = { [key: string]: T }

interface IParams<T> {
  /**
   * The source observable of the property. The property is updated according to this observable.
   *
   * @memberof IParams
   */
  source: Observable<T> | ((this: any) => Observable<T>)

  /**
   * Indicates whether the source may return an immediate observable as it is computed and has dependent
   * properties inside the function. In that case, it will be wrapped by `computed` function and
   * automatically update the property.
   *
   * @type {boolean}
   * @memberof IParams
   */
  isSourceComputed?: boolean

  /**
   * Initializes a computed function and whenever the function changes, the source will be subscribed
   * again.
   *
   * @returns {*} Anything.
   * @memberof IParams
   */
  computedBy?(): any

  /**
   * Indicates whether the value should be loaded immediately.
   *
   * `true` by default.
   *
   * @type {boolean}
   * @memberof IParams
   */
  loadImmediately?: boolean

  /**
   * The name(s) of the `props` of the `React.Component` class.
   * When any of these properties is changed, then the source will be called again and value will be updated.
   *
   * @type {(string | (string[]))}
   * @memberof IParams
   */
  onPropsChange?: string | (string[])

  /**
   * A value selector function. If this function is given, then values emitted from the `source` will be passed
   * to this function to determine whether the value should be assigned to the property or not.
   *
   * @param {T} value Value emitted from the observable.
   * @param {number} index The index of the value.
   * @returns {(boolean | { select: boolean, value: any })} True if the value should be assigned to the property.
   * @memberof IParams
   */
  select?(value: T, index: number): boolean | { select: boolean, value: any }

  /**
   * Manual function to control whether the source should be called again to update the property when this
   * function return true.
   *
   * @param {*} prevProps Previous properties of the current `React.Component`.
   * @param {*} prevState Previous state of the current `React.Component`.
   * @param {*} snapshot Snapshot of the current `React.Component`.
   * @returns {boolean} True if the property should be updated by executing the observable again.
   * @memberof IParams
   */
  shouldUpdate?(prevProps: any, prevState: any, snapshot: any): boolean

  /**
   * Prepares the observed property with side effects.
   * The function is called for each time the observable emits a value.
   *
   * Anything returned from the function will be checked whether the key is in
   * the target or not. If the key is in the target, then the value of the
   * side effect will be assigned to the property.
   *
   * @param {T} value Value to be emitted.
   * @returns {(Dictionary<any> | undefined)} Side effect list as
   * ```js
   * { [key: propertyKey of target]: newValue }
   * ```
   * @memberof IParams
   */
  makeSideEffects?(value: T): Dictionary<any> | undefined
}

let unsubscribeMap: WeakMap<any, Dictionary<Subscription>>

/**
 * Makes the property `observable` and then connects the property to the `source` observable.
 * Whenever the `source` emits a value, the property will be updated accordingly.
 *
 * **NOTE**: This decorator also adds `loadData` function to the class to reset all dependent properties.
 *
 * **RECOMMENDATION**: Mark the property as `readonly`.
 *
 * @export
 * @template T Property type.
 * @param {IParams<T>} params Parameters.
 * @returns {PropertyDecorator} Property decorator.
 */
export function observed<T>(params: IParams<T>): PropertyDecorator {
  if (!unsubscribeMap) {
    unsubscribeMap = new WeakMap()
  }

  return function (target: any, propertyName: string | symbol) {
    const { source, select, loadImmediately = true, computedBy, makeSideEffects } = params
    let { shouldUpdate, onPropsChange, isSourceComputed = false } = params

    if (typeof computedBy === 'function') {
      isSourceComputed = true
    }

    const observableProperty = observable(target, propertyName)
    Object.defineProperty(target, propertyName, observableProperty)

    let subscription: Subscription | undefined

    function loadData(this: any) {
      if (unsubscribeMap.has(this)) {
        const subscriptions = unsubscribeMap.get(this)!
        if (propertyName in subscriptions) {
          subscriptions[ propertyName as string ].unsubscribe()
          delete subscriptions[ propertyName as string ]
        }
      }

      this.clearError?.()
      this.startLoading?.()

      let index = 0
      let isSet = false

      let source$: Observable<T>
      if (typeof source === 'function') {
        source$ = source.call(this)
      }
      else {
        source$ = source
      }

      subscription = source$.subscribe({
        error: error => {
          transaction(() => {
            this.stopLoading?.()
            this.setError?.(error)
          })
        },
        next: (value) => {
          transaction(() => {
            if (makeSideEffects) {
              const sideEffects = makeSideEffects.call(this, value)
              if (typeof sideEffects === 'object') {
                for (const key in sideEffects) {
                  if (!(key in this)) { continue }
                  if (key === '_') { continue }
                  runInAction(() => this[ key ] = sideEffects[ key ])
                }
              }
            }

            if (typeof select === 'function') {
              if (isSet) { return }
              const willBeSelected = select.call(this, value, index++)
              if (!willBeSelected) { return }
              else if (typeof willBeSelected === 'object') {
                if (!willBeSelected.select) { return }
                value = willBeSelected.value
              }

              runInAction(() => this[ propertyName ] = value)
              this.stopLoading?.()
              isSet = true
            }
            else {
              runInAction(() => {
                this[ propertyName ] = value
              })
            }
          }, this)
        },
        complete: () => {
          this.stopLoading?.()
          subscription = undefined
        }
      })

      if (unsubscribeMap.has(this)) {
        unsubscribeMap.get(this)![ propertyName as string ] = subscription
      }
      else {
        const subscriptions = {
          [ propertyName ]: subscription
        }

        unsubscribeMap.set(this, subscriptions)
      }
    }

    const originalLoadFunction = target[ 'loadData' ]
    Object.defineProperty(target, 'loadData', {
      configurable: true,
      value() {
        originalLoadFunction?.call(this ?? target)
        loadData.call(this ?? target)
      }
    })

    let computedValueDisposer: Lambda
    if (loadImmediately) {
      const originalDidMountFunction = target[ 'componentDidMount' ]
      Object.defineProperty(target, 'componentDidMount', {
        configurable: true,
        value(a: any, b: any, c: any) {
          originalDidMountFunction?.call(this ?? target, a, b, c)
          loadData.call(this ?? target)

          if (isSourceComputed) {
            const funcToBeComputed = (computedBy ?? (source as () => Observable<T>)).bind(this ?? target)
            computedValueDisposer = computed(funcToBeComputed).observe(_change => {
              loadData.call(this ?? target)
            })
          }
        }
      })

      if (isSourceComputed) {
        const originalWillUnmountFunction = target[ 'componentWillUnmount' ]
        Object.defineProperty(target, 'componentWillUnmount', {
          configurable: true,
          value() {
            originalWillUnmountFunction?.call(this ?? target)
            subscription?.unsubscribe()
            computedValueDisposer?.()
          }
        })
      }
    }

    if (typeof onPropsChange === 'string') {
      if (onPropsChange) {
        onPropsChange = [ onPropsChange ]
      }
    }

    if (Array.isArray(onPropsChange)) {
      if (typeof shouldUpdate !== 'function') {
        shouldUpdate = function (this: any, prevProps: any) {
          for (const propName of onPropsChange as string[]) {
            const previous = prevProps[ propName ]
            const current = this.props[ propName ]
            if (previous !== current) {
              return true
            }
          }

          return false
        }
      }
    }

    if (typeof shouldUpdate === 'function') {
      const originalUpdateFunction: Function = target[ 'componentDidUpdate' ]
      Object.defineProperty(target, 'componentDidUpdate', {
        value(prevProps: any, prevState: any, snapshot: any) {
          originalUpdateFunction?.call(this, prevProps, prevState, snapshot)
          if (shouldUpdate!.call(this, prevProps, prevState, snapshot)) {
            loadData.call(this)

            if (isSourceComputed) {
              computedValueDisposer?.()
              const funcToBeComputed = (computedBy ?? (source as () => Observable<T>)).bind(this ?? target)
              computedValueDisposer = computed(funcToBeComputed).observe(_change => {
                loadData.call(this ?? target)
              })
            }
          }
        }
      })
    }
  }
}

export interface HasObservedValues {
  loadData(): void
}
