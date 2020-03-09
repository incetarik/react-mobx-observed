# react-mobx-observed
`@observed` decorator for MobX and React/React-Native projects.

This package adds `@observed` decorator to your environment. Utilizes `mobx`, `rxjs` and `react` packages.

`@observed` decorator is used for properties to automatically update them according to provided observable.
Additionally, you can pass the source as observable returning function, which will be called with related `React.Component` class' instance as `this`.
The returned observable will be used as the source for the decorated property.

There is also a setting for marking the source observable returning function as computed, hence whenever the dependent value changes, the observable is re-subscribed and the emitted values are assigned to the property.

Apart from the source function, you can specify another computed function which will cause the re-subscription to the source observable.

You can also list several properties your component class has and whenever they change, the source observable will be re-subscribed.

Likewise, you can also select when to assign a value when it is emitted from the source observable.

There is also a function to determine whether the property should be updated or not. This will have arguments given by `shouldComponentUpdate` function of `React.Component` and will be bound to the instance. Hence, you can reach class properties as `this.`.

Lastly, there is side-effect property of this decorator which allows you to update several other properties of the class while it is still updating the decorated properties.

This decorator is also adds a function to the class called `loadData`. This is for manual calls.

This library uses `WeakMap`s to prevent modifications on the instance.

# Examples
```ts
@observer
class VideoCommentsView extends React.PureComponent<{ video: IVideo }> {
  @observed({
    // Whenever the property `video` changes
    onPropsChange: 'video',
    // Or whenever any change happens on `comments` property of the `video`
    computedBy(this: VideoCommentsView) { return this.props.video.comments },
    // Load the comments of the video (returns an Observable)
    source(this: VideoCommentsView) { return loadCommentsOf$(this.props.video) }
  })
  readonly comments!: IVideoComment[] // Readonly because the property will be updated automatically.

  @observed({ source: likes$ })
  readonly likes!: IVideoLike[]

  @observed({
    // Source is computed, which means that whenever the viewState.currentVideo (observable) changes, the source will be subscribed again.
    isSourceComputed: true,
    source() { return getOwner$(viewState.currentVideo) }
  })
  readonly owner!: IVideoOwner

  @observed({
    // Whenever the `video` or `videoSources` change
    onPropsChange: [ 'video', 'videoSources' ],
    source(this: VideoCommentsView) {
      // Assume this observable emits value as
      // { name: string, value: any }
      // where name is the event name and the value is event value
      return getSourceInfo$(this.props.video)
    },
    select(data) {
      // Select (to assign to the property) when data.name is source
      // and the value to assign will be the `data.value`
      // If `data.name` is not source, then skip this
      return { select: data.name === 'source', value: data.value }
    },
    makeSideEffects(data) {
      // While the source is extracting, it may send information
      // such as the thumbnail, and assume we also want to update
      // the thumbnail information.

      // If the emitted event name is not `thumbnail`, skip.
      if (data.name !== 'thumbnail') { return }

      // Otherwise, assign the `thumbnail` property of this class, as `data.value`
      return { thumbnail: data.value }
    }
    readonly source!: string

    // This will be updated whenever source is being updated as a side-effect of updating source.
    @observable readonly thumbnail!: string
  })

  render() {
    return (
      <View>
        {this.comments.map(comment => <VideoComment model={comment}/>)}
      </View>
    )
  }
}
```
