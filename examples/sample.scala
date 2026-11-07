object Main {
  def add(a: Int, b: Int): Int = {
    val unusedVal = 99
    a + b
  }

  def unusedMethod(x: Int): Int = x * 2

  def main(args: Array[String]): Unit = {
    println(add(2, 3))
  }
}
